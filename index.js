const DEFAULT_BASE_URL = "https://app.shiprelay.io";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 120000;

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

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  const line = `${name}=${String(value)}\n`;
  require("fs").appendFileSync(outputFile, line);
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = body?.error || `HTTP ${response.status}`;
    throw new Error(error);
  }

  return body;
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
  const audience = getInput("audience", "user") || "user";
  const autoPublish = toBoolean(getInput("auto-publish", "false"));
  const baseUrl = (process.env.SHIPRELAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

  if (!apiKey) {
    fail("API key invalid");
  }

  const ref = process.env.GITHUB_REF;
  const repository = process.env.GITHUB_REPOSITORY;
  const tag = getTagFromRef(ref);

  if (!tag) {
    fail("ShipRelay release action must run on tag pushes (refs/tags/*).");
  }

  if (!repository) {
    fail("Missing GitHub repository context.");
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

    if (message.toLowerCase().includes("api key")) {
      fail("API key invalid");
    }

    if (message.toLowerCase().includes("repository")) {
      fail("Repository not connected");
    }

    if (message.toLowerCase().includes("tag")) {
      fail("Tag not found");
    }

    fail(message);
  }
}

run();
