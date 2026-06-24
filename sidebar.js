// Agent to use - defaulted patient summary
let agentType = "patient-summary";

// GitHub Pages bridge page URL
const BRIDGE_URL =
    "https://custom-chrome-extension.github.io/agent-extension/bridge.html";

// GitHub Pages base origin (used for secure postMessage targeting)
const BRIDGE_ORIGIN = "https://custom-chrome-extension.github.io";

// Max characters to send — prevents truncation in the agent
// Roughly 15,000 chars ≈ 3,000 words. Adjust up if your agent handles more.
const MAX_CHARS = 15000;

// ─────────────────────────────────────────────────────────────────────
// PROMPT TEMPLATE
// {PATIENT_DATA} is replaced with the extracted page text
// {PAGE_TITLE}   is replaced with the browser tab title
// ─────────────────────────────────────────────────────────────────────
const PROMPT_TEMPLATE = `
You are reviewing a patient medical record. Below is all of the information extracted from this patient's record page, including content from any collapsed or hidden sections.

Please analyse this record thoroughly and provide a structured clinical summary covering:
- Any medications without a clearly documented reason
- Conditions implied by medications but absent from the problem list
- Gaps or inconsistencies in the problem list
- Lab or investigation results that require attention
- Medication interactions or monitoring concerns
- Overdue screenings or follow-ups
- Allergy or contraindication conflicts
- Unexplained symptoms or complaints
- Unaddressed social or lifestyle risk factors

Where information is incomplete or ambiguous, acknowledge that uncertainty clearly — do not guess or assume. If something is not present in the record, say so rather than inferring it without evidence.

After your summary, I may ask follow-up questions about this patient. Answer based only on what is documented in the record below, and flag clearly when a question cannot be answered from the available information.

---
PAGE: {PAGE_TITLE}
---

{PATIENT_DATA}

---
End of patient record. Please begin your analysis.
`.trim();

// ── Attach a listener to the select element ───────────────────────────
const agentSelect = document.getElementById("agent");

agentSelect.addEventListener('change', (event) => {
    agentType = event.target.value;

    const bridgeFrame = document.getElementById("bridge-frame");

    if (bridgeFrame) {
        bridgeFrame.contentWindow.postMessage(
            { type: "SET_AGENT", agentType: agentType },
            BRIDGE_ORIGIN,
        );
    }
});

// ── Load bridge page in iframe ────────────────────────────────────────
if (BRIDGE_URL) {
    document.getElementById("placeholder").remove();

    const iframe = document.createElement("iframe");
    iframe.id = "bridge-frame";
    iframe.src = BRIDGE_URL;
    iframe.allow = `clipboard-read ${BRIDGE_ORIGIN}; clipboard-write ${BRIDGE_ORIGIN}`;

    iframe.addEventListener("load", () => {
        document.getElementById("dot").classList.add("live");
    });

    document.body.appendChild(iframe);
}

// ── Status helpers ────────────────────────────────────────────────────
function setStatus(msg, type = "") {
    const el = document.getElementById("status");
    el.className = "status" + (type ? " " + type : "");
    if (type === "loading") {
        el.innerHTML = `<div class="spinner"></div> ${msg}`;
    } else {
        el.textContent = msg;
    }
}

// ── Clean extracted text ──────────────────────────────────────────────
function cleanPatientText(rawText) {
    return rawText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 2)
        .filter((line) => line.length < 500)
        .filter(
            (line) =>
                !/^(home|menu|close|back|next|previous|loading|search|skip|toggle)$/i.test(
                    line,
                ),
        )
        .join("\n");
}

// ── Hint banner ───────────────────────────────────────────────────────
function showHint() {
    document.getElementById("copy-hint").classList.add("visible");
}

function dismissHint() {
    document.getElementById("copy-hint").classList.remove("visible");
    document.getElementById("trunc-warning").classList.remove("visible");
}

// ── Main scan function ────────────────────────────────────────────────
async function scanPage() {
    const btn = document.getElementById("scan-btn");
    btn.disabled = true;
    dismissHint();
    setStatus("Reading page…", "loading");

    try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });

        // Inject content.js in case tab was open before extension loaded
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"],
            });
        } catch (e) {
            // Already injected — safe to ignore
        }

        // Extract full page DOM
        setStatus("Extracting patient data…", "loading");
        const response = await chrome.tabs.sendMessage(tab.id, {
            type: "GET_PAGE_CONTENT",
        });

        if (!response?.success) {
            throw new Error(
                response?.error ||
                    "Could not read page — try refreshing the tab",
            );
        }

        // Clean the extracted text
        setStatus("Building prompt…", "loading");
        const cleanedText = cleanPatientText(response.content);

        // Check for truncation
        let finalText = cleanedText;
        let wasTruncated = false;

        if (cleanedText.length > MAX_CHARS) {
            finalText = cleanedText.substring(0, MAX_CHARS);
            wasTruncated = true;

            const truncEl = document.getElementById("trunc-warning");
            truncEl.textContent = `⚠ Record is large (${Math.round(cleanedText.length / 1000)}k chars) — sending first ${Math.round(MAX_CHARS / 1000)}k chars. Ask the agent specifically about any sections not covered.`;
            truncEl.classList.add("visible");
        }

        // Build the full prompt
        const prompt = PROMPT_TEMPLATE.replace(
            "{PAGE_TITLE}",
            response.title || "Patient Record",
        ).replace("{PATIENT_DATA}", finalText);

        // ── Try postMessage to bridge page first (SDK path) ───────────────
        const bridgeFrame = document.getElementById("bridge-frame");

        if (bridgeFrame) {
            try {
                bridgeFrame.contentWindow.postMessage(
                    { type: "SEND_TO_AGENT", prompt: prompt },
                    BRIDGE_ORIGIN,
                );

                const words = Math.round(finalText.length / 5);
                setStatus(
                    `✓ Sent to agent — ${words.toLocaleString()} words${wasTruncated ? " (truncated)" : ""}`,
                    "success",
                );
                return; // postMessage succeeded — skip clipboard fallback
            } catch (e) {
                // Bridge not ready yet — fall through to clipboard
                console.warn(
                    "[Patient Summary] postMessage failed, falling back to clipboard:",
                    e,
                );
            }
        }

        // ── Clipboard fallback ────────────────────────────────────────────
        await navigator.clipboard.writeText(prompt);
        showHint();
        document.getElementById("bridge-frame")?.focus();

        const words = Math.round(finalText.length / 5);
        setStatus(
            `✓ Prompt copied — ${words.toLocaleString()} words${wasTruncated ? " (truncated)" : ""}`,
            "success",
        );
    } catch (err) {
        setStatus("Error: " + err.message, "error");
        console.error("[Patient Summary]", err);
    } finally {
        btn.disabled = false;
    }
}
