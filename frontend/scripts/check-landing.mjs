import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.resolve(__dirname, "../../docs/screenshots");

async function checkLanding() {
  console.log("Checking Landing Page via Playwright...");
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "msedge" });
  } catch (e1) {
    try {
      browser = await chromium.launch({ headless: true, channel: "chrome" });
    } catch (e2) {
      browser = await chromium.launch({ headless: true });
    }
  }

  const consoleErrors = [];
  const cssRequests = [];

  // 1. Desktop Test (1440x900)
  const contextDesktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const pageDesktop = await contextDesktop.newPage();

  pageDesktop.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(`[Console Error] ${msg.text()}`);
    }
  });

  pageDesktop.on("response", (res) => {
    if (res.request().resourceType() === "stylesheet" || res.url().includes(".css")) {
      cssRequests.push({ url: res.url(), status: res.status() });
    }
  });

  console.log("Navigating to http://localhost:3000 (Desktop 1440px)...");
  await pageDesktop.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 30000 });
  await pageDesktop.waitForTimeout(2000);

  // Check computed styles
  const desktopStyles = await pageDesktop.evaluate(() => {
    const body = document.body;
    const computed = window.getComputedStyle(body);
    const scrollWidth = document.documentElement.scrollWidth;
    const clientWidth = document.documentElement.clientWidth;
    return {
      bgColor: computed.backgroundColor,
      color: computed.color,
      overflowX: computed.overflowX,
      scrollWidth,
      clientWidth,
      hasHorizontalOverflow: scrollWidth > clientWidth,
    };
  });

  console.log("Desktop Computed Styles:", desktopStyles);

  const desktopScreenshot = path.join(screenshotsDir, "landing-desktop-1440.png");
  await pageDesktop.screenshot({ path: desktopScreenshot, fullPage: false });
  console.log(`Saved screenshot: ${desktopScreenshot}`);

  // 2. Mobile Test (375x812)
  const contextMobile = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  const pageMobile = await contextMobile.newPage();

  console.log("Navigating to http://localhost:3000 (Mobile 375px)...");
  await pageMobile.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 30000 });
  await pageMobile.waitForTimeout(2000);

  const mobileStyles = await pageMobile.evaluate(() => {
    const scrollWidth = document.documentElement.scrollWidth;
    const clientWidth = document.documentElement.clientWidth;
    return {
      scrollWidth,
      clientWidth,
      hasHorizontalOverflow: scrollWidth > clientWidth,
    };
  });

  console.log("Mobile Viewport Check:", mobileStyles);

  const mobileScreenshot = path.join(screenshotsDir, "landing-mobile-375.png");
  await pageMobile.screenshot({ path: mobileScreenshot, fullPage: false });
  console.log(`Saved screenshot: ${mobileScreenshot}`);

  await browser.close();

  const results = {
    cssRequestsCount: cssRequests.length,
    css200: cssRequests.every((r) => r.status === 200),
    consoleErrorsCount: consoleErrors.length,
    consoleErrors,
    desktopStyles,
    mobileStyles,
    desktopScreenshot,
    mobileScreenshot,
  };

  console.log("\nLanding Page Quality Check Results:");
  console.log(`- CSS requests received: ${results.cssRequestsCount} (All 200: ${results.css200})`);
  console.log(`- Console errors: ${results.consoleErrorsCount}`);
  console.log(`- Desktop Body background: ${desktopStyles.bgColor}`);
  console.log(`- Desktop Horizontal overflow: ${desktopStyles.hasHorizontalOverflow ? "FAIL" : "NONE (PASS)"}`);
  console.log(`- Mobile Horizontal overflow: ${mobileStyles.hasHorizontalOverflow ? "FAIL" : "NONE (PASS)"}`);

  if (results.consoleErrorsCount > 0) {
    console.warn("Console Errors found:", consoleErrors);
  }

  if (desktopStyles.hasHorizontalOverflow || mobileStyles.hasHorizontalOverflow) {
    throw new Error("Horizontal overflow detected on landing page!");
  }

  return results;
}

checkLanding().catch((err) => {
  console.error("Playwright Check Error:", err);
  process.exit(1);
});
