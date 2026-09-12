import { FormEvent, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { api, setAccess } from "./api";

type User = { id: string; name: string; role: "ADMIN" | "PM" | "DEVELOPER" };
type Project = { id: string; name: string; client: { name: string } };
type Client = { id: string; name: string };
type Developer = { id: string; name: string; email: string };
type ManagedUser = Developer & { role: string };
type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  isOverdue: boolean;
  assignee?: { name: string };
};
const statuses = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];

function Login({ onLogin }: { onLogin: (user: User, token: string) => void }) {
  const [email, setEmail] = useState("admin@velozity.dev");
  const [password, setPassword] = useState("Password123!");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const { data } = await api.post("/auth/login", { email, password });
      onLogin(data.user, data.accessToken);
    } catch {
      setError("Sign-in failed");
    }
  }
  return (
    <main className="login">
      <form onSubmit={submit}>
        <h1>Velozity</h1>
        <p>Client project dashboard</p>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        <button>Sign in</button>
        {error && <small>{error}</small>}
        <small>Seed: admin@velozity.dev / Password123!</small>
      </form>
    </main>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [feed, setFeed] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState({
    status: "",
    priority: "",
    dueFrom: "",
    dueTo: "",
  });
  const unread = notifications.filter((n) => !n.readAt).length;
  async function load(project?: Project | null) {
    if (!user) return;
    const [projectResult, dashboardResult, notificationResult] =
      await Promise.all([
        api.get("/projects"),
        api.get("/dashboard"),
        api.get("/notifications"),
      ]);
    setProjects(projectResult.data);
    setDashboard(dashboardResult.data);
    setNotifications(notificationResult.data);
    const target = project ?? selected ?? projectResult.data[0];
    if (target) {
      setSelected(target);
      const params = Object.fromEntries(
        Object.entries(filter).filter(([, value]) => value),
      );
      const [taskResult, activityResult] = await Promise.all([
        api.get(`/projects/${target.id}/tasks`, { params }),
        api.get("/activities"),
      ]);
      setTasks(taskResult.data);
      setFeed(activityResult.data);
      socket?.emit("project:join", target.id);
    }
  }
  useEffect(() => {
    async function restoreSession() {
      try {
        const { data } = await api.post("/auth/refresh");
        setAccess(data.accessToken);
        setUser(data.user);
      } catch {
        setAccess("");
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    }

    void restoreSession();
  }, []);
  useEffect(() => {
    if (user) {
      void load();
      void loadManagement();
    }
  }, [user]);
  useEffect(() => {
    if (selected) void load(selected);
  }, [filter.status, filter.priority, filter.dueFrom, filter.dueTo]);
  function signedIn(nextUser: User, token: string) {
    setAccess(token);
    setUser(nextUser);
    const nextSocket = io(
      import.meta.env.VITE_SOCKET_URL ?? "http://localhost:4000",
      { auth: { token } },
    );
    nextSocket.on("activity:new", (event) => {
      setFeed((items) => [event, ...items].slice(0, 20));
    });
    nextSocket.on("notification:new", (event) =>
      setNotifications((items) => [event, ...items]),
    );
    nextSocket.on("presence", (online) =>
      setDashboard((old: any) => (old ? { ...old, online } : old)),
    );
    setSocket(nextSocket);
  }
  async function loadManagement() {
    if (!user || user.role === "DEVELOPER") return;
    const requests: Promise<any>[] = [
      api.get("/clients"),
      api.get("/users/developers"),
    ];
    if (user.role === "ADMIN") requests.push(api.get("/users"));
    const [clientResult, developerResult, userResult] =
      await Promise.all(requests);
    setClients(clientResult.data);
    setDevelopers(developerResult.data);
    if (userResult) setManagedUsers(userResult.data);
  }
  async function logout() {
    try {
      await api.post("/auth/logout");
    } finally {
      socket?.disconnect();
      setAccess("");
      setUser(null);
      setProjects([]);
      setSelected(null);
      setTasks([]);
      setFeed([]);
      setNotifications([]);
    }
  }
  async function submitProject(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);

  try {
    await api.post("/projects", {
      name: form.get("name"),
      clientId: form.get("clientId"),
      description: form.get("description") || undefined,
    });

    const { data } = await api.get("/projects");
    setProjects(data);

    event.currentTarget.reset();
    setNotice("Project created.");
  } catch {
    setNotice("Could not create project.");
  }
}
  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    try {
      await api.post(`/projects/${selected.id}/tasks`, {
        title: form.get("title"),
        assigneeId: form.get("assigneeId") || null,
        priority: form.get("priority"),
        dueDate: form.get("dueDate"),
        description: form.get("description") || undefined,
      });
      event.currentTarget.reset();
      setNotice("Task assigned.");
      await load(selected);
    } catch {
      setNotice("Could not create task.");
    }
  }
async function submitClient(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();

  const form = new FormData(event.currentTarget);
  const name = form.get("name");

  try {
    await api.post("/clients", {
      name,
    });
    setNotice("zzzz");
    const { data } = await api.get("/clients");
    console.log("UPDATED CLIENTS:", data);
    setClients(data);
    event.currentTarget.reset();
  } catch {
    setNotice("");
  }
}
async function submitUser(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();

  const form = new FormData(event.currentTarget);

  try {
    await api.post("/users", {
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      role: form.get("role"),
    });

    const { data } = await api.get("/users");

    console.log("UPDATED USERS:", data);

    setManagedUsers(data);
    event.currentTarget.reset();
    setNotice("User created.");
  } catch (error: any) {
    console.log("USER ERROR:", error.response?.status);
    console.log("USER ERROR DATA:", error.response?.data);

    setNotice(
      error.response?.data?.error?.message ||
        error.response?.data?.message ||
        "",
    );
  }
}
  async function changeStatus(task: Task, status: string) {
    await api.patch(`/tasks/${task.id}/status`, { status });
    await load(selected);
  }
  async function readAll() {
    await api.post("/notifications/read-all");
    setNotifications((items) =>
      items.map((item) => ({ ...item, readAt: new Date().toISOString() })),
    );
  }
  if (authLoading) return <div>Loading...</div>;
  if (!user) return <Login onLogin={signedIn} />;
  return (
    <main>
      <header>
        <div>
          <b>Velozity</b>
          <span>
            {user.name} · {user.role}
          </span>
        </div>
        <button className="logout" onClick={() => void logout()}>
          Log out
        </button>
        <div className="bell" onClick={() => void readAll()}>
          Notifications <i>{unread}</i>
        </div>
      </header>
      <section className="layout">
        <aside>
          <h3>Projects</h3>
          {projects.map((project) => (
            <button
              className={selected?.id === project.id ? "selected" : ""}
              key={project.id}
              onClick={() => void load(project)}
            >
              {project.name}
              <small>{project.client?.name}</small>
            </button>
          ))}
        </aside>
        <div className="content">
          <h1>{selected?.name ?? "Dashboard"}</h1>
          {notice && <p className="notice">{notice}</p>}
          <div className="cards">
            {user.role === "ADMIN" && (
              <>
                <Card title="Projects" value={dashboard?.projects} />
                <Card title="Overdue" value={dashboard?.overdue} />
                <Card title="Online" value={dashboard?.online} />
              </>
            )}
            {user.role === "PM" && (
              <>
                <Card title="My projects" value={dashboard?.projects} />
                <Card title="Upcoming" value={dashboard?.upcoming?.length} />
              </>
            )}
            {user.role === "DEVELOPER" && (
              <Card title="Assigned tasks" value={dashboard?.tasks?.length} />
            )}
          </div>
          {(user.role === "ADMIN" || user.role === "PM") && (
            <section className="management">
              <h2>Project management</h2>
              <form onSubmit={submitProject}>
                <input name="name" required placeholder="New project name" />
                <select name="clientId" required>
                  <option value="">Choose client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
                <input
                  name="description"
                  placeholder="Description (optional)"
                />
                <button>Create project</button>
              </form>
              {selected && (
                <form onSubmit={submitTask}>
                  <input name="title" required placeholder="New task title" />
                  <select name="assigneeId">
                    <option value="">Unassigned</option>
                    {developers.map((developer) => (
                      <option key={developer.id} value={developer.id}>
                        {developer.name}
                      </option>
                    ))}
                  </select>
                  <select name="priority" defaultValue="MEDIUM">
                    <option>LOW</option>
                    <option>MEDIUM</option>
                    <option>HIGH</option>
                    <option>CRITICAL</option>
                  </select>
                  <input type="date" name="dueDate" required />
                  <input name="description" placeholder="Task description" />
                  <button>Assign task</button>
                </form>
              )}
            </section>
          )}
          {user.role === "ADMIN" && (
            <section className="management admin-management">
              <h2>Administration</h2>
              <form onSubmit={submitClient}>
                <input name="name" required placeholder="New client name" />
                <button>Create client</button>
              </form>
              <form onSubmit={submitUser}>
                <input name="name" required placeholder="User name" />
                <input name="email" type="email" required placeholder="Email" />
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  required
                  placeholder="Temporary password"
                />
                <select name="role" defaultValue="DEVELOPER">
                  <option value="DEVELOPER">Developer</option>
                  <option value="PM">Project Manager</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <button>Create user</button>
              </form>
              {managedUsers.length > 0 && (
                <small>
                  Users:{" "}
                  {managedUsers
                    .map((member) => `${member.name} (${member.role})`)
                    .join(" · ")}
                </small>
              )}
            </section>
          )}
          <div className="filters">
            <select
              value={filter.status}
              onChange={(e) => setFilter({ ...filter, status: e.target.value })}
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
            <select
              value={filter.priority}
              onChange={(e) =>
                setFilter({ ...filter, priority: e.target.value })
              }
            >
              <option value="">All priorities</option>
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
            <input
              type="date"
              aria-label="Due from"
              value={filter.dueFrom}
              onChange={(e) =>
                setFilter({ ...filter, dueFrom: e.target.value })
              }
            />
            <input
              type="date"
              aria-label="Due to"
              value={filter.dueTo}
              onChange={(e) => setFilter({ ...filter, dueTo: e.target.value })}
            />
          </div>
          <h2>Tasks</h2>
          <div className="tasks">
            {tasks.map((task) => (
              <article key={task.id}>
                <div>
                  <b>{task.title}</b>
                  <small>
                    {task.assignee?.name ?? "Unassigned"} · due{" "}
                    {new Date(task.dueDate).toLocaleDateString()}{" "}
                    {task.isOverdue && <em>OVERDUE</em>}
                  </small>
                </div>
                <select
                  value={task.status}
                  onChange={(e) => void changeStatus(task, e.target.value)}
                >
                  {statuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
                <span className={`priority ${task.priority}`}>
                  {task.priority}
                </span>
              </article>
            ))}
          </div>
        </div>
        <aside className="activity">
          <h3>Live activity</h3>
          {feed.map((activity) => (
            <p key={activity.id}>
              {activity.message}
              <small>{new Date(activity.createdAt).toLocaleString()}</small>
            </p>
          ))}
        </aside>
      </section>
    </main>
  );
}
function Card({ title, value }: { title: string; value: any }) {
  return (
    <article className="card">
      <small>{title}</small>
      <strong>{value ?? "-"}</strong>
    </article>
  );
}
