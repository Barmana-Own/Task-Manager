import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(backendRoot, '.env') });

const [{ default: pool }, { buildProjectProgressSnapshot, buildProjectReportText, writeProjectReportFile }] = await Promise.all([
  import('../src/config/db.js'),
  import('../src/utils/projectProgress.js'),
]);

const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
const reportDate = process.argv[2] || localNow.toISOString().slice(0, 10);

try {
  const [projects] = await pool.execute("SELECT id FROM projects WHERE status IN ('planning','active','on_hold') ORDER BY id");
  for (const project of projects) {
    const snapshot = await buildProjectProgressSnapshot({ projectId: project.id, reportDate, user: null, connection: pool });
    if (snapshot.notFound) continue;
    const saved = snapshot.saved || {};
    const notes = {
      delayNote: saved.delayNote || '',
      lossAmount: saved.lossAmount || '',
      lossUnit: saved.lossUnit || 'تومان',
      lossNote: saved.lossNote || '',
      managerNote: saved.managerNote || '',
    };
    const text = buildProjectReportText(snapshot, notes);
    await pool.execute(
      `INSERT INTO project_daily_progress_reports
        (project_id, report_date, planned_progress, actual_progress, variance_progress, total_tasks, done_tasks,
         in_progress_tasks, overdue_tasks, delay_days, tracked_seconds, generated_text, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         planned_progress = VALUES(planned_progress), actual_progress = VALUES(actual_progress), variance_progress = VALUES(variance_progress),
         total_tasks = VALUES(total_tasks), done_tasks = VALUES(done_tasks), in_progress_tasks = VALUES(in_progress_tasks),
         overdue_tasks = VALUES(overdue_tasks), delay_days = VALUES(delay_days), tracked_seconds = VALUES(tracked_seconds),
         generated_text = VALUES(generated_text), generated_at = NOW()`,
      [project.id, reportDate, snapshot.plannedProgress, snapshot.actualProgress, snapshot.varianceProgress,
        snapshot.totalTasks, snapshot.doneTasks, snapshot.inProgressTasks, snapshot.overdueTasks, snapshot.delayDays,
        snapshot.trackedSeconds, text],
    );
    const file = await writeProjectReportFile(snapshot, text);
    console.log(`Generated: ${file.filename}`);
  }
  console.log(`Daily project reports completed for ${reportDate}.`);
} finally {
  await pool.end();
}
