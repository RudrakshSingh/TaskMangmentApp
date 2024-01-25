const express = require("express");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const cron = require("node-cron");
const twilio = require("twilio");
const crypto = require("crypto");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = crypto.randomBytes(32).toString("hex");
const USER_FILE = "user.json";
const TOKEN_FILE = "token.json";

app.use(bodyParser.json());

// Twilio credentials
const accountSid = "ACff801b577568636f3808747317ef69e2";
const authToken = "381746f2c6a9204ecf89195c72a195a5";
const fromPhoneNumber = "+12409494389";
const client = new twilio(accountSid, authToken);

let users = loadFile(USER_FILE, []);
let tokens = loadFile(TOKEN_FILE, { jwtToken: null });
let tasks = loadFile("tasks.json", []);
let subTasks = loadFile("subtasks.json", []);

function loadFile(filename, defaultValue) {
  try {
    const data = fs.readFileSync(filename);
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      return defaultValue;
    }
    console.error(`Error loading ${filename}:`, error);
    return defaultValue;
  }
}

function saveFile(filename, data) {
  try {
    fs.writeFileSync(filename, JSON.stringify(data));
  } catch (error) {
    console.error(`Error saving ${filename}:`, error);
  }
}

const generateToken = (userId) =>
  jwt.sign({ userId }, SECRET_KEY, { expiresIn: "1h" });

const authenticateToken = (req, res, next) => {
  const tokenHeader = req.header("Authorization");
  console.log("Recived token", token);

  if (!tokenHeader || !tokenHeader.startsWith("Bearer ")) {
    console.error("Unauthorized: Token not provided");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = tokenHeader.replace("Bearer ", "");

  jwt.verify(token.replace("Bearer ", ""), SECRET_KEY, (err, user) => {
    if (err) {
      console.error("Forbidden: Invalid token");
      return res.status(403).json({ error: "Forbidden" });
    }

    req.user = user;
    console.log("Token Verified. User:", user);

    next();
  });
};

app.post("/login", (req, res) => {
  const { userId } = req.body;
  const authenticatedUser = users.find((user) => user.id === userId);

  if (!authenticatedUser) {
    console.error("Unauthorized: User not found");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const jwtToken = generateToken(userId);
  tokens.jwtToken = jwtToken;
  saveFile(TOKEN_FILE, tokens);

  console.log("Login successful. User:", authenticatedUser);
  console.log("Generated Token:", jwtToken);

  res.status(200).json({ message: "Login successful", token: jwtToken });
});

app.get("/stored-token", (req, res) => {
  const { jwtToken } = tokens;
  res.status(200).json({ storedToken: jwtToken });
});

app.post("/logout", authenticateToken, (req, res) => {
  tokens.jwtToken = null;
  saveFile(TOKEN_FILE, tokens);
  res.status(200).json({ message: "Logout successful" });
});

// Task Routes
app.post("/tasks", authenticateToken, (req, res) => {
  const { title, description, due_date } = req.body;
  const userId = req.user.userId;

  if (!title || !description || !due_date) {
    console.error("Invalid input: All fields are required.");
    return res
      .status(400)
      .json({ error: "Invalid input. All fields are required." });
  }

  const priority = calculateTaskPriority(due_date);
  const task = {
    title,
    description,
    due_date,
    priority,
    userId,
    status: "TODO",
  };

  tasks.push(task);
  saveFile("tasks.json", tasks);

  res.status(201).json({ message: "Task created successfully", task });
});

app.get("/tasks", authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const userTasks = tasks.filter((task) => task.userId === userId);
  res.status(200).json({ tasks: userTasks });
});

app.get("/tasks/:taskId", authenticateToken, (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const userId = req.user.userId;
  const task = tasks.find((t) => t.userId === userId && t.id === taskId);

  if (!task) return res.status(404).json({ error: "Task not found" });

  res.status(200).json({ task });
});

app.put("/tasks/:taskId", authenticateToken, (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const userId = req.user.userId;
  const { title, description, due_date, status } = req.body;
  const task = tasks.find((t) => t.userId === userId && t.id === taskId);

  if (!task) return res.status(404).json({ error: "Task not found" });

  if (title) task.title = title;
  if (description) task.description = description;
  if (due_date) {
    task.due_date = due_date;
    task.priority = calculateTaskPriority(due_date);
  }
  if (status) task.status = status;

  saveFile("tasks.json", tasks);
  res.status(200).json({ message: "Task updated successfully", task });
});

app.delete("/tasks/:taskId", authenticateToken, (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const userId = req.user.userId;
  const taskIndex = tasks.findIndex(
    (t) => t.userId === userId && t.id === taskId
  );

  if (taskIndex === -1)
    return res.status(404).json({ error: "Task not found" });

  const deletedTask = tasks[taskIndex];
  tasks.splice(taskIndex, 1);
  saveFile("tasks.json", tasks);
  res
    .status(200)
    .json({ message: "Task deleted successfully", task: deletedTask });
});

// Subtask Routes
app.get("/subtasks/:taskId", authenticateToken, (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const userId = req.user.userId;
  const task = tasks.find((t) => t.userId === userId && t.id === taskId);

  if (!task) return res.status(404).json({ error: "Task not found" });

  const userSubTasks = subTasks.filter((subTask) => subTask.task_id === taskId);
  res.status(200).json({ subTasks: userSubTasks });
});

app.post("/subtasks/:taskId", authenticateToken, (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const userId = req.user.userId;
  const { status } = req.body;
  const task = tasks.find((t) => t.userId === userId && t.id === taskId);

  if (!task) return res.status(404).json({ error: "Task not found" });

  const subTask = { id: subTasks.length + 1, task_id: taskId, status };
  subTasks.push(subTask);
  saveFile("subtasks.json", subTasks);

  res.status(201).json({ message: "Sub task created successfully", subTask });
});

app.get("/subtasks/:taskId", authenticateToken, (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const userId = req.user.userId;
  const task = tasks.find((t) => t.userId === userId && t.id === taskId);

  if (!task) return res.status(404).json({ error: "Task not found" });

  const userSubTasks = subTasks.filter((subTask) => subTask.task_id === taskId);
  res.status(200).json({ subTasks: userSubTasks });
});

app.put("/subtasks/:subTaskId", authenticateToken, (req, res) => {
  const subTaskId = parseInt(req.params.subTaskId);
  const { status } = req.body;
  const subTask = subTasks.find((st) => st.id === subTaskId);

  if (!subTask) return res.status(404).json({ error: "Sub task not found" });

  if (status !== undefined) subTask.status = status;

  saveFile("subtasks.json", subTasks);
  res.status(200).json({ message: "Sub task updated successfully", subTask });
});

app.delete("/subtasks/:subTaskId", authenticateToken, (req, res) => {
  const subTaskId = parseInt(req.params.subTaskId);
  const subTaskIndex = subTasks.findIndex((st) => st.id === subTaskId);

  if (subTaskIndex === -1)
    return res.status(404).json({ error: "Sub task not found" });

  const deletedSubTask = subTasks[subTaskIndex];
  subTasks.splice(subTaskIndex, 1);
  saveFile("subtasks.json", subTasks);
  res.status(200).json({
    message: "Sub task deleted successfully",
    subTask: deletedSubTask,
  });
});

// Cron Jobs
cron.schedule("0 0 * * *", () =>
  tasks.forEach(
    (task) => (task.priority = calculateTaskPriority(task.due_date))
  )
);
cron.schedule("0 0 * * *", () =>
  tasks.forEach(
    (task) =>
      task.status !== "DONE" &&
      new Date(task.due_date) < new Date() &&
      users.find((u) => u.id === task.userId) &&
      sendSms(
        users.find((u) => u.id === task.userId).phone_number,
        `Task overdue: ${task.title}`
      )
  )
);

// Utility Functions
const calculateTaskPriority = (due_date) =>
  Math.floor((new Date(due_date) - new Date()) / (1000 * 60 * 60 * 24));

const sendSms = (to, body) => {
  client.messages
    .create({
      body,
      from: "+12409494389",
      to,
    })
    .then((message) => console.log(`SMS sent: ${message.sid}`))
    .catch((error) => console.error(`Error sending SMS: ${error.message}`));
};

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
