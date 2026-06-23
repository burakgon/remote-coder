import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { installService, renderLaunchdPlist, renderSystemdUnit } from "../src/install.js";

describe("renderLaunchdPlist", () => {
  test("is a valid-looking LaunchAgent plist running node on the CLI as the login user", () => {
    const plist = renderLaunchdPlist({
      label: "com.remote-coder",
      nodePath: "/usr/local/bin/node",
      cliPath: "/opt/rc/index.js",
      dataDir: "/Users/me/.config/remote-coder",
    });
    expect(plist).toContain("<!DOCTYPE plist");
    expect(plist).toContain("<string>com.remote-coder</string>");
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/opt/rc/index.js</string>");
    expect(plist).toContain("REMOTE_CODER_DATA_DIR");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
  });

  test("the data dir env value is the supplied dir (no embedded secret/token)", () => {
    const plist = renderLaunchdPlist({
      label: "com.remote-coder",
      nodePath: "/usr/local/bin/node",
      cliPath: "/opt/rc/index.js",
      dataDir: "/Users/me/.config/remote-coder",
    });
    expect(plist).toContain("<string>/Users/me/.config/remote-coder</string>");
    expect(plist).not.toMatch(/ACCESS_TOKEN|token/i);
  });
});

describe("renderSystemdUnit", () => {
  test("is a [Service] unit for the user manager running node on the CLI", () => {
    const unit = renderSystemdUnit({
      nodePath: "/usr/bin/node",
      cliPath: "/opt/rc/index.js",
      dataDir: "/home/me/.config/remote-coder",
    });
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("ExecStart=/usr/bin/node /opt/rc/index.js");
    expect(unit).toContain("Environment=REMOTE_CODER_DATA_DIR=/home/me/.config/remote-coder");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("WantedBy=default.target");
  });

  test("restarts on failure and never embeds a secret/token", () => {
    const unit = renderSystemdUnit({
      nodePath: "/usr/bin/node",
      cliPath: "/opt/rc/index.js",
      dataDir: "/home/me/.config/remote-coder",
    });
    expect(unit).toContain("Restart=on-failure");
    expect(unit).not.toMatch(/ACCESS_TOKEN|token/i);
  });
});

describe("installService (against a temp HOME — never the real ~)", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rc-install-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  test("darwin writes a per-user LaunchAgent plist (~/Library/LaunchAgents) and prints launchctl", () => {
    const { path, instructions } = installService({
      nodePath: "/usr/local/bin/node",
      cliPath: "/opt/rc/index.js",
      dataDir: "/Users/me/.config/remote-coder",
      home,
      os: "darwin",
    });
    expect(path).toBe(join(home, "Library", "LaunchAgents", "com.remote-coder.plist"));
    const written = readFileSync(path, "utf8");
    expect(written).toContain("<string>com.remote-coder</string>");
    expect(written).toContain("<string>/opt/rc/index.js</string>");
    // user-level load command, NOT a system daemon / sudo
    expect(instructions).toContain("launchctl load");
    expect(instructions).not.toMatch(/sudo|LaunchDaemons/);
    // world-readable but owner-writable only
    expect(statSync(path).mode & 0o777).toBe(0o644);
  });

  test("linux writes a systemd --user unit (~/.config/systemd/user) and prints systemctl --user", () => {
    const { path, instructions } = installService({
      nodePath: "/usr/bin/node",
      cliPath: "/opt/rc/index.js",
      dataDir: "/home/me/.config/remote-coder",
      home,
      os: "linux",
    });
    expect(path).toBe(join(home, ".config", "systemd", "user", "remote-coder.service"));
    const written = readFileSync(path, "utf8");
    expect(written).toContain("ExecStart=/usr/bin/node /opt/rc/index.js");
    expect(written).toContain("WantedBy=default.target");
    // user-level enable, NOT a system unit / sudo
    expect(instructions).toContain("systemctl --user");
    expect(instructions).not.toMatch(/sudo/);
  });

  test("an unsupported platform errors clearly instead of writing the wrong unit", () => {
    expect(() =>
      installService({
        nodePath: "/usr/bin/node",
        cliPath: "/opt/rc/index.js",
        dataDir: "/data",
        home,
        os: "win32",
      }),
    ).toThrow(/unsupported|manually/i);
  });
});
