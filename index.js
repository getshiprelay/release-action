const DEFAULT_BASE_URL = "https://shiprelay.io";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 120000;
const FETCH_TIMEOUT_MS = 30000;
const ALLOWED_AUDIENCES = new Set(["developer", "user", "executive", "all"]);
const REPOSITORY_PATTERN = /^[^/]+\/[^/]+$/;
const crypto = require("crypto");

const core = {
  setSecret(value) {
    if (!value) return;
    process.stdout.write(`::add-mask::${String(value)}\n`);
  },
  setFailed(message) {
    console.error(`❌ ${message}`);
    process.exit(1);
  },
};

function getInput(name, fallback = "") {
  const envKeyUnderscore = `INPUT_${name.replace(/-/g, "_").toUpperCase()}`;
  const envKeyHyphen = `INPUT_${name.toUpperCase()}`;
  return (
    process.env[envKeyUnderscore] ||
    process.env[envKeyHyphen] ||
    fallback
  ).trim();
}

function toBoolean(value) {
  return String(value).toLowerCase() === "true";
}

function sanitizeOutputValue(value) {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  const sanitizedValue = sanitizeOutputValue(value);
  const delimiter = `SHIPRELAY_${crypto.randomUUID()}`;
  const block = `${name}<<${delimiter}\n${sanitizedValue}\n${delimiter}\n`;
  require("fs").appendFileSync(outputFile, block);
}

function fail(message) {
  core.setFailed(message);
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`ShipRelay API error (HTTP ${response.status})`);
  }

  return response.json().catch(() => ({}));
}

function resolveBaseUrl() {
  const configuredBaseUrl = (process.env.SHIPRELAY_BASE_URL || "").trim();

  if (!configuredBaseUrl) {
    return DEFAULT_BASE_URL;
  }

  if (configuredBaseUrl !== DEFAULT_BASE_URL) {
    console.warn("⚠️ Custom SHIPRELAY_BASE_URL detected. Only trusted HTTPS URLs should be used.");
  }

  if (!configuredBaseUrl.startsWith("https://")) {
    fail("SHIPRELAY_BASE_URL must use HTTPS to protect API credentials");
  }

  return configuredBaseUrl;
}

function getTagFromRef(ref) {
  const prefix = "refs/tags/";
  if (!ref || !ref.startsWith(prefix)) {
    return null;
  }
  return ref.slice(prefix.length);
}

async function waitForDraftReady(baseUrl, apiKey, draftId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const status = await apiRequest(`${baseUrl}/api/v1/releases/${encodeURIComponent(draftId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (status.status === "generation_failed") {
      throw new Error("Generation failed. Open the draft in ShipRelay for details.");
    }

    if (status.ready) {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Timed out waiting for draft generation (2m timeout).");
}

async function run() {
  const apiKey = getInput("api-key");
  core.setSecret(apiKey);
  const audience = getInput("audience", "user") || "user";
  const repositoryInput = getInput("repository");
  const autoPublish = toBoolean(getInput("auto-publish", "false"));
  const baseUrl = resolveBaseUrl().replace(/\/$/, "");

  if (!apiKey) {
    fail("API key invalid");
  }

  if (!ALLOWED_AUDIENCES.has(audience)) {
    fail("Invalid audience. Allowed values: developer, user, executive, all");
  }

  const ref = process.env.GITHUB_REF;
  const repository = repositoryInput || process.env.GITHUB_REPOSITORY;
  const tag = getTagFromRef(ref);

  if (!tag) {
    fail("ShipRelay release action must run on tag pushes (refs/tags/*).");
  }

  if (!repository) {
    fail("Missing GitHub repository context.");
  }

  if (!REPOSITORY_PATTERN.test(repository)) {
    fail("Invalid repository format. Expected owner/repo.");
  }

  setOutput("version", tag);

  try {
    const createResult = await apiRequest(`${baseUrl}/api/v1/releases`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        repository,
        tag,
        audience,
        autoPublish,
      }),
    });

    const draftId = createResult.draftId;
    const draftUrl = createResult.draftUrl || `${baseUrl}/changelogs/${draftId}`;

    if (!draftId) {
      fail("Release API did not return a draft ID.");
    }

    const readyStatus = await waitForDraftReady(baseUrl, apiKey, draftId);
    const readyDraftUrl = readyStatus.draftUrl || draftUrl;

    setOutput("draft-url", readyDraftUrl);

    if (!autoPublish) {
      console.log(`✅ ShipRelay changelog generated for ${tag}`);
      console.log(`📝 Review draft: ${readyDraftUrl}`);
      return;
    }

    const publishResult = await apiRequest(
      `${baseUrl}/api/v1/releases/${encodeURIComponent(draftId)}/publish`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    const changelogUrl = publishResult.changelogUrl;

    if (!changelogUrl) {
      fail("Publish succeeded but changelog URL was not returned.");
    }

    setOutput("changelog-url", changelogUrl);

    console.log(`✅ ShipRelay changelog published for ${tag}`);
    console.log(`📄 View: ${changelogUrl}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeoutMessage =
      error && typeof error === "object" && "name" in error && error.name === "TimeoutError";

    if (timeoutMessage || message.toLowerCase().includes("timeout")) {
      fail("ShipRelay API request timed out (30s). Check network connectivity and try again.");
    }

    const statusMatch = message.match(/ShipRelay API error \(HTTP (\d{3})\)/i);
    if (statusMatch) {
      fail(`ShipRelay API error (HTTP ${statusMatch[1]}). Check your API key and repository settings.`);
    }

    if (message.toLowerCase().includes("api key")) {
      fail("API key invalid");
    }

    if (message.toLowerCase().includes("repository")) {
      fail("Repository not connected");
    }

    if (message.toLowerCase().includes("tag")) {
      fail("Tag not found");
    }

    fail("ShipRelay action failed. Check inputs and repository configuration.");
  }
}

run();
