import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  provisionStaffMember,
  ProvisioningError,
  ProvisioningOperationalError,
} from "../src/lib/staff/provisioning";

interface ParsedArgs {
  email: string;
  name: string;
  employeeNumber: string;
  department: string;
  isBootstrap: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    email: "",
    name: "",
    employeeNumber: "",
    department: "",
    isBootstrap: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--bootstrap-first-admin") {
      parsed.isBootstrap = true;
      parsed.department = "ADMIN";
    } else if (arg === "--email" && i + 1 < args.length) {
      parsed.email = args[++i];
    } else if (arg === "--name" && i + 1 < args.length) {
      parsed.name = args[++i];
    } else if (arg === "--employee" && i + 1 < args.length) {
      parsed.employeeNumber = args[++i];
    } else if (arg === "--department" && i + 1 < args.length) {
      parsed.department = args[++i].toUpperCase();
    } else if (arg === "--password") {
      console.error(
        "[Staff Provisioning] FAILED: INVALID_ARGUMENTS - Passwords cannot be passed via command line flags."
      );
      process.exit(1);
    }
  }

  return parsed;
}

async function readMaskedPassword(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    output.write(promptText);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding("utf-8");

    let password = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.removeListener("data", onData);
          if (stdin.setRawMode) {
            stdin.setRawMode(wasRaw || false);
          }
          stdin.pause();
          output.write("\n");
          resolve(password);
          return;
        } else if (char === "\u0003") {
          // SIGINT
          stdin.removeListener("data", onData);
          if (stdin.setRawMode) {
            stdin.setRawMode(wasRaw || false);
          }
          stdin.pause();
          output.write("\n");
          process.exit(130);
        } else if (char === "\u0008" || char === "\x7f") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function readStdinPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    input.setEncoding("utf-8");
    input.on("data", (chunk) => {
      data += chunk;
    });
    input.on("end", () => {
      const firstLine = data.split(/[\r\n]+/)[0]?.trim() || "";
      resolve(firstLine);
    });
    input.on("error", () => {
      reject(new Error("STDIN_READ_FAILED"));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log("Usage: npm run staff:provision -- [options]");
    console.log("Options:");
    console.log(
      "  --bootstrap-first-admin   Provision the initial admin account (department must be ADMIN)"
    );
    console.log("  --email <email>           Staff work email");
    console.log("  --name <name>             Staff full name");
    console.log("  --employee <number>       Staff employee number");
    console.log("  --department <dept>       Staff department (SALES, OPERATIONS, FINANCE, ADMIN)");
    console.log("  --help, -h                Show this help message");
    console.log("");
    console.log("Password Entry:");
    console.log("  In interactive TTY mode, passwords are securely prompted without echoing.");
    console.log("  In automation/non-TTY mode, pass the temporary password via stdin.");
    process.exit(0);
  }

  let password = "";

  if (input.isTTY) {
    const rl = readline.createInterface({ input, output });
    try {
      if (!args.email) {
        args.email = await rl.question("Work Email: ");
      }
      if (!args.name) {
        args.name = await rl.question("Full Name: ");
      }
      if (!args.employeeNumber) {
        args.employeeNumber = await rl.question("Employee Number (e.g. EMP-1001): ");
      }
      if (!args.department && !args.isBootstrap) {
        args.department = (
          await rl.question("Department (SALES/OPERATIONS/FINANCE/ADMIN): ")
        ).toUpperCase();
      }
    } finally {
      rl.close();
    }

    const pass1 = await readMaskedPassword("Initial Temporary Password: ");
    const pass2 = await readMaskedPassword("Confirm Initial Temporary Password: ");

    if (pass1 !== pass2) {
      console.error("[Staff Provisioning] FAILED: PASSWORD_CONFIRMATION_MISMATCH");
      process.exit(1);
    }
    password = pass1;
  } else {
    // Non-TTY mode: password read through stdin only
    try {
      password = await readStdinPassword();
    } catch {
      console.error("[Staff Provisioning] FAILED: STDIN_READ_ERROR");
      process.exit(1);
    }
  }

  if (!password) {
    console.error("[Staff Provisioning] FAILED: PASSWORD_REQUIRED");
    process.exit(1);
  }

  console.log("[Staff Provisioning] Processing staff provisioning...");

  try {
    const result = await provisionStaffMember({
      email: args.email,
      fullName: args.name,
      employeeNumber: args.employeeNumber,
      department: (args.department || "ADMIN") as "SALES" | "OPERATIONS" | "FINANCE" | "ADMIN",
      password,
      isBootstrap: args.isBootstrap,
    });

    console.log("[Staff Provisioning] SUCCESS");
    console.log(`- User ID: ${result.userId}`);
    console.log(`- Department: ${result.department}`);
    console.log(`- Must Change Password: ${result.mustChangePassword}`);
    console.log(`- Idempotent: ${result.idempotent}`);
    process.exit(0);
  } catch (err) {
    if (err instanceof ProvisioningError) {
      console.error(`[Staff Provisioning] FAILED: ${err.code}`);
    } else if (err instanceof ProvisioningOperationalError) {
      console.error(`[Staff Provisioning] CRITICAL: ${err.code} [ID: ${err.orphanUserId}]`);
    } else {
      console.error("[Staff Provisioning] FAILED: UNEXPECTED_ERROR");
    }
    process.exit(1);
  }
}

main();
