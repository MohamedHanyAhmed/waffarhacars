import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { provisionStaffMember, ProvisioningError } from "../src/lib/staff/provisioning.ts";

function parseArgs(args) {
  const parsed = {
    email: "",
    name: "",
    employeeNumber: "",
    department: "",
    isBootstrap: false,
    password: "",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--bootstrap-first-admin") {
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
    } else if (arg === "--password" && i + 1 < args.length) {
      // Direct pass for automated scripts/tests
      parsed.password = args[++i];
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // If interactive prompt needed
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
    if (!args.password) {
      if (process.env.STAFF_PROVISIONING_PASSWORD) {
        args.password = process.env.STAFF_PROVISIONING_PASSWORD;
      } else {
        args.password = await rl.question("Initial Temporary Password (min 12 chars): ");
      }
    }

    rl.close();

    console.log("[Staff Provisioning] Initiating provisioning workflow...");

    const result = await provisionStaffMember({
      email: args.email,
      fullName: args.name,
      employeeNumber: args.employeeNumber,
      department: args.department,
      password: args.password,
      isBootstrap: args.isBootstrap,
    });

    console.log("[Staff Provisioning] SUCCESS!");
    console.log(`- User ID: ${result.userId}`);
    console.log(`- Employee Number: ${result.employeeNumber}`);
    console.log(`- Department: ${result.department}`);
    console.log(`- Must Change Password: ${result.mustChangePassword}`);
    console.log(`- Idempotent: ${result.idempotent}`);

    process.exit(0);
  } catch (err) {
    rl.close();
    if (err instanceof ProvisioningError) {
      console.error(`[Staff Provisioning] FAILED [${err.code}]: ${err.message}`);
    } else if (err && typeof err === "object" && "orphanUserId" in err) {
      console.error(`[Staff Provisioning] CRITICAL OPERATIONAL FAILURE [${err.code}]`);
      console.error(`Orphan User ID: ${err.orphanUserId}`);
      console.error(`Remediation: ${err.message}`);
    } else {
      console.error(
        `[Staff Provisioning] UNEXPECTED ERROR: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
    process.exit(1);
  }
}

main();
