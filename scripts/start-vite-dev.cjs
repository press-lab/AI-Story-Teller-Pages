const { spawn } = require("child_process");

const child = spawn(
  "cmd.exe",
  ["/d", "/c", ".\\node_modules\\.bin\\vite.cmd --host 127.0.0.1 --port 5173 > vite-dev.out.log 2> vite-dev.err.log"],
  {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  },
);

child.unref();
console.log(child.pid);
