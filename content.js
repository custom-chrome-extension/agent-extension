// content.js
// Injected into the patient record page.
// Extracts ALL text from the DOM including hidden/collapsed panels.

function extractPageContent() {

  // 1 — Temporarily reveal elements hidden via the HTML hidden attribute
  const hiddenEls = [...document.querySelectorAll('[hidden]')];
  hiddenEls.forEach(el => el.removeAttribute('hidden'));

  // 2 — Temporarily reveal elements hidden via aria-hidden
  const ariaHidden = [...document.querySelectorAll('[aria-hidden="true"]')];
  ariaHidden.forEach(el => el.setAttribute('aria-hidden', 'false'));

  // 3 — Remove script/style/noscript so their source code doesn't
  //     pollute the patient data
  const removed = [...document.querySelectorAll('script, style, noscript')].map(el => {
    const ref = { el, parent: el.parentNode, next: el.nextSibling };
    el.parentNode.removeChild(el);
    return ref;
  });

  // 4 — Read all text (textContent is CSS-blind so display:none panels included)
  const rawText = document.body.textContent
    .replace(/\t/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim();

  // 5 — Restore everything we touched
  removed.forEach(({ el, parent, next }) => parent.insertBefore(el, next));
  hiddenEls.forEach(el => el.setAttribute('hidden', ''));
  ariaHidden.forEach(el => el.setAttribute('aria-hidden', 'true'));

  return rawText;
}

// Listen for the sidebar asking for page content
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_PAGE_CONTENT') {
    try {
      const content = extractPageContent();
      sendResponse({
        success: true,
        content: content,
        title: document.title,
        url: window.location.href
      });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }
  return true;
});
