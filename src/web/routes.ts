import express from "express";
import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";

export const router = express.Router();

const OUTPUT_DIR = path.join(__dirname, "..", "..", "output");
const DIST_DIR = path.join(__dirname, "..", "..", "dist");

// ============================================================
// HELPERS
// ============================================================

interface Artifact {
  name: string;
  path: string;
  size: number;
  date: string;
  type: "json" | "html" | "md" | "other";
}

function getArtifacts(): Artifact[] {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  return fs.readdirSync(OUTPUT_DIR)
    .filter(f => !f.startsWith("."))
    .map(f => {
      const fullPath = path.join(OUTPUT_DIR, f);
      const stat = fs.statSync(fullPath);
      const ext = path.extname(f).slice(1).toLowerCase();
      let type: Artifact["type"] = "other";
      if (ext === "json") type = "json";
      else if (ext === "html") type = "html";
      else if (ext === "md") type = "md";
      return {
        name: f,
        path: fullPath,
        size: stat.size,
        date: stat.mtime.toISOString(),
        type,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function getLatestSummary(): Record<string, any> | null {
  const artifacts = getArtifacts().filter(a => a.name.startsWith("sprint-summary-") && a.type === "json");
  if (artifacts.length === 0) return null;
  // Sort by filename (encodes date) descending — most recent first
  artifacts.sort((a, b) => b.name.localeCompare(a.name));
  try {
    return JSON.parse(fs.readFileSync(artifacts[0].path, "utf-8"));
  } catch {
    return null;
  }
}

function getAllSummaries(): Array<{ date: string; data: Record<string, any> }> {
  const artifacts = getArtifacts().filter(a => a.name.startsWith("sprint-summary-") && a.type === "json");
  // Sort by filename (encodes date) descending
  artifacts.sort((a, b) => b.name.localeCompare(a.name));
  return artifacts.map(a => {
    try {
      return { date: a.date, data: JSON.parse(fs.readFileSync(a.path, "utf-8")) };
    } catch {
      return { date: a.date, data: {} };
    }
  });
}

// Color-coded health grade
function gradeClass(grade: string): string {
  switch (grade?.toUpperCase()) {
    case "A": return "grade-a";
    case "B": return "grade-b";
    case "C": return "grade-c";
    case "D": return "grade-d";
    case "F": return "grade-f";
    default: return "";
  }
}

function severityClass(severity: string): string {
  return severity === "CRITICAL" ? "severity-critical" : "severity-warning";
}

// ============================================================
// DASHBOARD — Main page with daily summary
// ============================================================

router.get("/", (_req, res) => {
  const latest = getLatestSummary();
  const artifacts = getArtifacts();
  const summaries = getAllSummaries();

  res.render("dashboard", {
    title: "Sprint Monitor — Dashboard",
    currentUser: (_req as any).currentUser,
    latest,
    artifacts: artifacts.slice(0, 10),
    summaries,
    helpers: {
      gradeClass,
      severityClass,
      formatDate: (d: string) => new Date(d).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
      }),
      formatSize: (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      },
    },
  });
});

// ============================================================
// SPRINT HEALTH — Detailed hygiene findings
// ============================================================

router.get("/sprint-health", (_req, res) => {
  const latest = getLatestSummary();

  if (!latest) {
    return res.render("sprint-health", {
      title: "Sprint Health — Sprint Monitor",
      currentUser: (_req as any).currentUser,
      data: null,
      helpers: { gradeClass, severityClass },
    });
  }

  res.render("sprint-health", {
    title: "Sprint Health — Sprint Monitor",
    currentUser: (_req as any).currentUser,
    data: latest,
    helpers: { gradeClass, severityClass },
  });
});

// ============================================================
// ARTIFACTS — Browse past reports and outputs
// ============================================================

router.get("/artifacts", (req, res) => {
  const artifacts = getArtifacts();

  // Filter by type
  const filter = (req.query.type as string) || "all";
  const filtered = filter === "all"
    ? artifacts
    : artifacts.filter(a => a.type === filter);

  res.render("artifacts", {
    title: "Artifacts — Sprint Monitor",
    currentUser: (req as any).currentUser,
    artifacts: filtered,
    filter,
    helpers: {
      formatDate: (d: string) => new Date(d).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      }),
      formatSize: (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      },
    },
  });
});

// View individual artifact content
router.get("/artifacts/view/:name", (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.name);

  // Security: prevent directory traversal
  if (!filePath.startsWith(OUTPUT_DIR)) {
    return res.status(403).send("Forbidden");
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Artifact not found");
  }

  const ext = path.extname(filePath).slice(1).toLowerCase();

  if (ext === "json") {
    try {
      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return res.json(content);
    } catch {
      return res.status(500).send("Failed to parse JSON artifact");
    }
  }

  if (ext === "html") {
    return res.sendFile(filePath);
  }

  // For .md and others, render as text
  const content = fs.readFileSync(filePath, "utf-8");
  res.type("text/plain").send(content);
});

// ============================================================
// API — Refresh / re-run analysis
// ============================================================

router.post("/api/refresh", async (_req, res) => {
  try {
    // Run the sprint analyzer in the background
    const analyzerPath = path.join(DIST_DIR, "sprint-analyzer.js");

    if (!fs.existsSync(analyzerPath)) {
      return res.status(500).json({
        status: "error",
        message: "Analyzer not built. Run `npm run build` first.",
      });
    }

    // Spawn as background process — respond immediately
    const child = spawn("node", [analyzerPath], {
      cwd: path.join(__dirname, "..", ".."),
      detached: true,
      stdio: "ignore",
    });

    child.unref();

    res.json({
      status: "ok",
      message: "Analysis triggered. Check back in a minute for updated results.",
    });
  } catch (err: any) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ============================================================
// API — Status (for health checks and quick status)
// ============================================================

router.get("/api/status", (_req, res) => {
  const latest = getLatestSummary();
  res.json({
    status: "ok",
    hasData: !!latest,
    lastRun: latest ? (latest as any).metadata?.generatedAt : null,
    grade: latest ? (latest as any).grade : null,
  });
});

// ============================================================
// TRENDING — Sprint-over-sprint trend data
// ============================================================

router.get("/api/trending", (_req, res) => {
  const summaries = getAllSummaries();
  const trendData = summaries.slice(0, 14).reverse().map(s => {
    const d = s.data as any;
    const summary = d?.summary;
    return {
      date: s.date,
      grade: d?.grade,
      completionPct: summary?.currentSprintMetrics?.completionPct ?? 0,
      totalTasks: summary?.totalTasksCurrent ?? 0,
      activeTasks: summary?.activeTasksCurrent ?? 0,
      criticalIssues: summary?.criticalIssues ?? 0,
      warnings: summary?.warnings ?? 0,
    };
  });

  res.json(trendData);
});
