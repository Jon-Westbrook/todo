import express from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

const DATA_FILE = "/home/ubuntu/data/todo.jsonl";
const AUTH_FILE = "/home/ubuntu/data/todo-auth.json";
const PORT = Number(process.env.PORT || 3456);
const HOST = process.env.HOST || "127.0.0.1";
const BASE_PATH = (() => {
  const raw = (process.env.BASE_PATH || "").trim();
  if (!raw || raw === "/") return "";
  const normalized = raw.startsWith("/") ? raw : "/" + raw;
  return normalized.replace(/\/$/, "");
})();
const TERMINAL_STATUSES = new Set(["done", "not-an-issue", "duplicate"]);

const validTokens = new Map();

function routePath(path) {
  return BASE_PATH + path;
}

function getAuthConfig() {
  return JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
}

function readTodos() {
  if (!existsSync(DATA_FILE)) return [];
  const content = readFileSync(DATA_FILE, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function writeTodos(todos) {
  writeFileSync(DATA_FILE, todos.map((t) => JSON.stringify(t)).join("\n") + "\n");
}

function nowTimestamp() {
  return new Date().toISOString();
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

(function migrateNums() {
  const todos = readTodos();
  let changed = false;
  todos.forEach((t, i) => {
    if (!t.num) {
      t.num = i + 1;
      changed = true;
    }
  });
  if (changed) writeTodos(todos);
})();

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  const token = auth.slice(7);
  if (!validTokens.has(token)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

if (BASE_PATH) {
  app.get("/", (req, res) => res.redirect(BASE_PATH));
}

app.use(BASE_PATH || "/", express.static(__dirname));

app.post(routePath("/api/auth"), (req, res) => {
  const { code } = req.body;
  const config = getAuthConfig();
  if (code !== config.code) return res.status(403).json({ error: "Nope." });
  const token = randomUUID();
  validTokens.set(token, { created: Date.now() });
  const maxAge = (config.cookieMaxAge || 2592000) * 1000;
  for (const [t, v] of validTokens) {
    if (Date.now() - v.created > maxAge) validTokens.delete(t);
  }
  res.json({ token, maxAge: config.cookieMaxAge });
});

app.get(routePath("/api/todos"), requireAuth, (req, res) => {
  res.json(readTodos());
});

app.post(routePath("/api/todos"), requireAuth, (req, res) => {
  const todos = readTodos();
  const nextNum = Math.max(...todos.map((t) => t.num || 0), 0) + 1;
  const status = req.body.status || "open";
  const timestamp = nowTimestamp();
  const todo = {
    id: randomUUID().slice(0, 8),
    num: nextNum,
    title: req.body.title || "Untitled",
    section: req.body.section || "personal",
    priority: req.body.priority || "medium",
    status,
    created: timestamp,
    closed: isTerminalStatus(status) ? timestamp : null,
    notes: req.body.notes || "",
    due: req.body.due || null,
    order: req.body.order ?? todos.length,
  };
  todos.push(todo);
  writeTodos(todos);
  res.status(201).json(todo);
});

app.patch(routePath("/api/todos/:id"), requireAuth, (req, res) => {
  const todos = readTodos();
  const idx = todos.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const todo = todos[idx];
  const updates = { ...req.body, id: todo.id };

  if (Object.prototype.hasOwnProperty.call(req.body, "status")) {
    if (isTerminalStatus(req.body.status)) {
      updates.closed = todo.closed || nowTimestamp();
    } else {
      updates.closed = null;
    }
  }

  Object.assign(todo, updates);
  writeTodos(todos);
  res.json(todo);
});

app.post(routePath("/api/todos/reorder"), requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids must be an array" });
  const todos = readTodos();
  for (let i = 0; i < ids.length; i++) {
    const t = todos.find((x) => x.id === ids[i]);
    if (t) t.order = i;
  }
  writeTodos(todos);
  res.json({ ok: true });
});

app.delete(routePath("/api/todos/:id"), requireAuth, (req, res) => {
  let todos = readTodos();
  const len = todos.length;
  todos = todos.filter((t) => t.id !== req.params.id);
  if (todos.length === len) return res.status(404).json({ error: "Not found" });
  writeTodos(todos);
  res.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  const suffix = BASE_PATH || "/";
  console.log("TODO app running on " + HOST + ":" + PORT + suffix);
});
