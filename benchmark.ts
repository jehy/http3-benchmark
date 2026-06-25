#!/usr/bin/env node

import puppeteer, { Browser } from "puppeteer";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { URL } from "url";
import { Command } from "commander";

interface RequestTiming {
  number: number;
  status: number;
  timeTotal: number;
  timeConnect: number;
  timeTTFB: number;
  error?: string;
  errorDetails?: string;
  errorType?: string;
}

interface BenchmarkResults {
  protocol: string;
  results: RequestTiming[];
  successful: number;
  failed: number;
  timeoutCount: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  p50: number;
  p90: number;
  p99: number;
  statusCodes: Map<number, number>;
  failedNumbers: number[];
  errorLog: string[];
  detailedErrors: Array<{
    number: number;
    type: string;
    message: string;
    details?: any;
  }>;
}

interface NetworkOptions {
  offline?: boolean;
  latency?: number;
  downloadThroughput?: number;
  uploadThroughput?: number;
}

const colors = {
  red: "\x1b[0;31m",
  green: "\x1b[0;32m",
  yellow: "\x1b[1;33m",
  blue: "\x1b[0;34m",
  magenta: "\x1b[0;35m",
  cyan: "\x1b[0;36m",
  bold: "\x1b[1m",
  nc: "\x1b[0m",
};

class PuppeteerBenchmark {
  private results: RequestTiming[] = [];
  private browser: Browser | null = null;
  private errorLog: string[] = [];
  private detailedErrors: Array<{
    number: number;
    type: string;
    message: string;
    details?: any;
  }> = [];
  private networkOptions: NetworkOptions;
  private networkDescription: string = "";

  constructor(networkOptions: NetworkOptions = {}) {
    this.networkOptions = networkOptions;
    this.buildNetworkDescription();
  }

  private buildNetworkDescription() {
    const parts = [];
    if (this.networkOptions.offline) parts.push("OFFLINE");
    if (this.networkOptions.latency)
      parts.push(`${this.networkOptions.latency}ms latency`);
    if (this.networkOptions.downloadThroughput) {
      const mbps = (
        this.networkOptions.downloadThroughput /
        1024 /
        1024
      ).toFixed(1);
      parts.push(`${mbps} Mbps down`);
    }
    if (this.networkOptions.uploadThroughput) {
      const mbps = (this.networkOptions.uploadThroughput / 1024 / 1024).toFixed(
        1,
      );
      parts.push(`${mbps} Mbps up`);
    }
    this.networkDescription = parts.length > 0 ? parts.join(", ") : "Normal";
  }

  async init(useHttp3: boolean = false, forceQuicOn?: string) {
    const args = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--enable-http2",
      "--disable-features=ImprovedCookieControls,IsolateOrigins,site-per-process",
    ];

    if (useHttp3 && forceQuicOn) {
      args.push(
        "--enable-quic",
        "--quic-version=h3",
        `--origin-to-force-quic-on=${forceQuicOn}`,
        "--disable-features=UseChromiumHttp3",
      );
    }

    try {
      this.browser = await puppeteer.launch({
        headless: true,
        args: args,
      });
    } catch (error: any) {
      const errorMsg = `Failed to launch browser: ${error.message}`;
      this.errorLog.push(errorMsg);
      throw new Error(errorMsg);
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  private async emulateNetwork(page: any) {
    if (
      !this.networkOptions.offline &&
      !this.networkOptions.latency &&
      !this.networkOptions.downloadThroughput &&
      !this.networkOptions.uploadThroughput
    ) {
      return;
    }

    const client = await page.target().createCDPSession();
    await client.send("Network.enable");

    if (this.networkOptions.offline) {
      await client.send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });
      return;
    }

    const conditions: any = {
      offline: false,
      latency: this.networkOptions.latency || 0,
      downloadThroughput:
        this.networkOptions.downloadThroughput || 1024 * 1024 * 10,
      uploadThroughput: this.networkOptions.uploadThroughput || 1024 * 1024 * 5,
    };

    await client.send("Network.emulateNetworkConditions", conditions);
  }

  private addDetailedError(
    number: number,
    type: string,
    message: string,
    details?: any,
  ) {
    this.detailedErrors.push({ number, type, message, details });
    console.log(
      `\n  ${colors.red}✗ Request #${number}: ${type} - ${message}${colors.nc}`,
    );
    if (details) {
      console.log(
        `  ${colors.yellow}   → ${JSON.stringify(details)}${colors.nc}`,
      );
    }
  }

  async doRequest(number: number, url: string): Promise<RequestTiming> {
    if (!this.browser) {
      this.addDetailedError(number, "INIT_ERROR", "Browser not initialized");
      return {
        number,
        status: 0,
        timeTotal: 0,
        timeConnect: 0,
        timeTTFB: 0,
        error: "INIT_ERROR",
        errorDetails: "Browser instance is null",
        errorType: "INIT_ERROR",
      };
    }

    let page = null;
    let responseStatus = 0;
    let responseReceived = false;

    try {
      page = await this.browser.newPage();

      await this.emulateNetwork(page);

      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(30000);

      await page.setUserAgent(
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      );

      await page.setExtraHTTPHeaders({
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "en-US,en;q=0.9,ru;q=0.8",
        "cache-control": "max-age=0",
        priority: "u=0, i",
        "sec-ch-ua": '"Not/A)Brand";v="99", "Chromium";v="148"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Linux"',
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
      });

      page.on("response", (response) => {
        if (response.url() === url) {
          responseStatus = response.status();
          responseReceived = true;
        }
      });

      page.on("pageerror", () => {});
      page.on("requestfailed", () => {});

      const startTime = Date.now();

      let response = null;
      let navigationError = null;

      try {
        response = await page.goto(url, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
      } catch (err: any) {
        navigationError = err;
      }

      const totalTime = (Date.now() - startTime) / 1000;

      if (responseReceived && responseStatus > 0) {
        if (responseStatus >= 200 && responseStatus < 400) {
          return {
            number,
            status: responseStatus,
            timeTotal: totalTime,
            timeConnect: totalTime * 0.15,
            timeTTFB: totalTime * 0.25,
          };
        } else {
          this.addDetailedError(
            number,
            `HTTP_${responseStatus}`,
            `HTTP error ${responseStatus}`,
            { status: responseStatus, totalTime },
          );
          return {
            number,
            status: responseStatus,
            timeTotal: totalTime,
            timeConnect: totalTime * 0.15,
            timeTTFB: totalTime * 0.25,
            error: `HTTP_${responseStatus}`,
            errorDetails: `HTTP ${responseStatus} error`,
            errorType: "HTTP_ERROR",
          };
        }
      }

      if (response) {
        const status = response.status();
        if (status >= 200 && status < 400) {
          return {
            number,
            status: status,
            timeTotal: totalTime,
            timeConnect: totalTime * 0.15,
            timeTTFB: totalTime * 0.25,
          };
        }
      }

      if (navigationError && navigationError.message.includes("timeout")) {
        this.addDetailedError(number, "TIMEOUT", `Request timed out`, {
          timeout: 30,
          totalTime,
        });
        return {
          number,
          status: 0,
          timeTotal: 30,
          timeConnect: 0,
          timeTTFB: 0,
          error: "TIMEOUT",
          errorDetails: navigationError.message,
          errorType: "TIMEOUT",
        };
      }

      if (navigationError) {
        const errorMsg = navigationError.message;
        let type = "NAVIGATION_ERROR";
        if (errorMsg.includes("ERR_CONNECTION_REFUSED"))
          type = "CONNECTION_REFUSED";
        else if (errorMsg.includes("ERR_NAME_NOT_RESOLVED")) type = "DNS_ERROR";
        else if (errorMsg.includes("ERR_SSL_PROTOCOL_ERROR"))
          type = "SSL_ERROR";
        else if (errorMsg.includes("ERR_QUIC_PROTOCOL_ERROR"))
          type = "QUIC_ERROR";

        this.addDetailedError(number, type, errorMsg, { totalTime });
        return {
          number,
          status: 0,
          timeTotal: totalTime,
          timeConnect: 0,
          timeTTFB: 0,
          error: type,
          errorDetails: errorMsg,
          errorType: type,
        };
      }

      this.addDetailedError(number, "UNKNOWN_ERROR", "Unknown error occurred", {
        totalTime,
        responseReceived,
        responseStatus,
      });
      return {
        number,
        status: 0,
        timeTotal: totalTime,
        timeConnect: 0,
        timeTTFB: 0,
        error: "UNKNOWN_ERROR",
        errorDetails: "Unknown error",
        errorType: "UNKNOWN",
      };
    } catch (error: any) {
      this.addDetailedError(
        number,
        "EXCEPTION",
        error.message || "Unknown exception",
      );
      return {
        number,
        status: 0,
        timeTotal: 0,
        timeConnect: 0,
        timeTTFB: 0,
        error: "EXCEPTION",
        errorDetails: error.message,
        errorType: "EXCEPTION",
      };
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (closeError: any) {}
      }
    }
  }

  async run(
    requests: number,
    url: string,
    useHttp3: boolean = false,
    forceQuicOn?: string,
  ): Promise<BenchmarkResults> {
    const protocol = useHttp3 ? "HTTP/3" : "HTTP/2";
    console.log(`  ${protocol}: Running ${requests} requests...`);
    console.log(`  📶 Network: ${this.networkDescription}`);

    try {
      await this.init(useHttp3, forceQuicOn);
    } catch (error: any) {
      this.addDetailedError(
        0,
        "INIT_ERROR",
        `Failed to initialize browser: ${error.message}`,
      );
      throw error;
    }

    console.log("    Warming up...");
    try {
      await this.doRequest(0, url);
    } catch (error: any) {}
    await this.sleep(500);

    for (let i = 1; i <= requests; i++) {
      try {
        const result = await this.doRequest(i, url);
        this.results.push(result);
      } catch (error: any) {
        this.addDetailedError(i, "CRITICAL_ERROR", error.message);
        this.results.push({
          number: i,
          status: 0,
          timeTotal: 0,
          timeConnect: 0,
          timeTTFB: 0,
          error: "CRITICAL_ERROR",
          errorDetails: error.message,
          errorType: "CRITICAL",
        });
      }

      const progress = Math.floor((i / requests) * 100);
      const done = Math.floor(progress / 2);
      const bar = "#".repeat(done) + " ".repeat(50 - done);
      process.stdout.write(
        `\r    [${bar}] ${progress}% - Request #${i}${" ".repeat(10)}`,
      );
    }

    console.log("\n");

    const results = this.analyzeResults(this.results, protocol);
    await this.close();

    return results;
  }

  private analyzeResults(
    results: RequestTiming[],
    protocol: string,
  ): BenchmarkResults {
    const successful = results.filter((r) => r.status >= 200 && r.status < 400);
    const failed = results.filter(
      (r) => r.status === 0 || r.status >= 400 || r.error,
    );
    const timeouts = results.filter((r) => r.error === "TIMEOUT");

    const times = successful.map((r) => r.timeTotal).filter((t) => t > 0);
    const statusCodes = new Map<number, number>();
    const failedNumbers: number[] = [];

    results.forEach((r) => {
      if (r.status > 0) {
        statusCodes.set(r.status, (statusCodes.get(r.status) || 0) + 1);
      }
      if (r.error || r.status === 0 || r.status >= 400) {
        failedNumbers.push(r.number);
      }
    });

    const sorted = [...times].sort((a, b) => a - b);

    return {
      protocol,
      results,
      successful: successful.length,
      failed: failed.length,
      timeoutCount: timeouts.length,
      avgTime:
        times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      minTime: sorted.length > 0 ? sorted[0] : 0,
      maxTime: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
      p50: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : 0,
      p90: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.9)] : 0,
      p99: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0,
      statusCodes,
      failedNumbers: [...new Set(failedNumbers)],
      errorLog: this.errorLog,
      detailedErrors: this.detailedErrors,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function printSeparator() {
  console.log(`${colors.blue}${"=".repeat(70)}${colors.nc}`);
}

function printHeader(title: string) {
  printSeparator();
  console.log(`${colors.blue}${colors.bold}  ${title}${colors.nc}`);
  printSeparator();
}

function printSubheader(title: string, color: string = colors.cyan) {
  console.log(
    `\n${color}${"-".repeat(40)} ${title} ${"-".repeat(40)}${colors.nc}`,
  );
}

function printResults(results: BenchmarkResults) {
  const color = results.protocol === "HTTP/2" ? colors.cyan : colors.magenta;
  printSubheader(results.protocol, color);

  console.log(
    `  ${colors.green}✓ Successful:${colors.nc} ${results.successful}`,
  );
  console.log(
    `  ${colors.red}✗ Errors:${colors.nc} ${results.failed - results.timeoutCount}`,
  );
  console.log(
    `  ${colors.yellow}⏱ Timeouts:${colors.nc} ${results.timeoutCount}`,
  );
  console.log(`  ${colors.red}✗ Total failed:${colors.nc} ${results.failed}`);
  console.log();

  if (results.successful > 0 && results.avgTime > 0) {
    console.log(`  ${colors.yellow}Time statistics (seconds):${colors.nc}`);
    console.log(`    Average:  ${results.avgTime.toFixed(4)}`);
    console.log(`    Median (P50):  ${results.p50.toFixed(4)}`);
    console.log(`    P90:      ${results.p90.toFixed(4)}`);
    console.log(`    P99:      ${results.p99.toFixed(4)}`);
    console.log(`    Min:      ${results.minTime.toFixed(4)}`);
    console.log(`    Max:      ${results.maxTime.toFixed(4)}`);
    console.log("");
  }

  if (results.statusCodes.size > 0) {
    console.log(`  ${colors.yellow}HTTP Status codes:${colors.nc}`);
    const total = results.successful + results.failed;
    for (const [code, count] of results.statusCodes) {
      const percent = total > 0 ? (count / total) * 100 : 0;
      const colorCode = code >= 200 && code < 400 ? colors.green : colors.red;
      console.log(
        `    ${colorCode}${code}${colors.nc}: ${count} (${percent.toFixed(1)}%)`,
      );
    }
    console.log();
  }

  if (results.detailedErrors && results.detailedErrors.length > 0) {
    console.log(
      `  ${colors.red}✗ Detailed Errors (${results.detailedErrors.length}):${colors.nc}`,
    );

    const groupedErrors = new Map<string, number>();
    results.detailedErrors.forEach((e) => {
      groupedErrors.set(e.type, (groupedErrors.get(e.type) || 0) + 1);
    });

    console.log(`  ${colors.yellow}Error types summary:${colors.nc}`);
    for (const [type, count] of groupedErrors) {
      console.log(`    ${type}: ${count}`);
    }
    console.log();

    console.log(`  ${colors.yellow}All errors by request:${colors.nc}`);
    const errorsByNumber = new Map<number, string>();
    results.detailedErrors.forEach((e) => {
      errorsByNumber.set(e.number, `${e.type}: ${e.message}`);
    });

    const sortedErrors = Array.from(errorsByNumber.entries()).sort(
      (a, b) => a[0] - b[0],
    );
    sortedErrors.forEach(([number, message]) => {
      console.log(`    #${number}: ${message}`);
    });
    console.log();
  }

  if (results.failedNumbers.length > 0) {
    const nums = results.failedNumbers.slice(0, 20).join(", ");
    const suffix =
      results.failedNumbers.length > 20
        ? ` ... (${results.failedNumbers.length} total)`
        : "";
    console.log(
      `  ${colors.red}Failed requests list:${colors.nc} ${nums}${suffix}`,
    );
    console.log();
  }
}

function printComparison(
  results2: BenchmarkResults,
  results3: BenchmarkResults,
) {
  console.log(`\n${colors.blue}${"═".repeat(70)}${colors.nc}`);
  console.log(
    `${colors.blue}${colors.bold}  📊 COMPARISON: HTTP/2 vs HTTP/3${colors.nc}`,
  );
  console.log(`${colors.blue}${"═".repeat(70)}${colors.nc}`);
  console.log("");

  console.log(
    `  ${colors.cyan}HTTP/2:${colors.nc}  ${results2.avgTime.toFixed(4)}s (${results2.successful} successful)`,
  );
  console.log(
    `  ${colors.magenta}HTTP/3:${colors.nc}  ${results3.avgTime.toFixed(4)}s (${results3.successful} successful)`,
  );
  console.log("");

  console.log(`  ${colors.yellow}Percentiles comparison:${colors.nc}`);
  console.log(
    `    P50:  HTTP/2 ${results2.p50.toFixed(4)}s  vs  HTTP/3 ${results3.p50.toFixed(4)}s`,
  );
  console.log(
    `    P90:  HTTP/2 ${results2.p90.toFixed(4)}s  vs  HTTP/3 ${results3.p90.toFixed(4)}s`,
  );
  console.log(
    `    P99:  HTTP/2 ${results2.p99.toFixed(4)}s  vs  HTTP/3 ${results3.p99.toFixed(4)}s`,
  );
  console.log("");

  if (
    results2.successful > 0 &&
    results3.successful > 0 &&
    results2.avgTime > 0 &&
    results3.avgTime > 0
  ) {
    if (results2.avgTime < results3.avgTime) {
      const diff =
        ((results3.avgTime - results2.avgTime) / results2.avgTime) * 100;
      const absDiff = results3.avgTime - results2.avgTime;
      console.log(
        `  ${colors.green}🏆  HTTP/2 is faster by ${diff.toFixed(2)}% (${absDiff.toFixed(4)}s)${colors.nc}`,
      );
    } else if (results3.avgTime < results2.avgTime) {
      const diff =
        ((results2.avgTime - results3.avgTime) / results3.avgTime) * 100;
      const absDiff = results2.avgTime - results3.avgTime;
      console.log(
        `  ${colors.green}🏆  HTTP/3 is faster by ${diff.toFixed(2)}% (${absDiff.toFixed(4)}s)${colors.nc}`,
      );
    } else {
      console.log(`  ${colors.yellow}⚖️  Protocols are equal${colors.nc}`);
    }
  } else {
    console.log(
      `  ${colors.red}❌  Not enough data for comparison${colors.nc}`,
    );
  }
  console.log("");

  console.log(`  ${colors.yellow}Errors:${colors.nc}`);
  console.log(`    HTTP/2: ${results2.detailedErrors.length}`);
  console.log(`    HTTP/3: ${results3.detailedErrors.length}`);
  console.log("");
}

// CLI setup
const program = new Command();

program
  .name("http-benchmark")
  .description("HTTP/2 vs HTTP/3 benchmark using Puppeteer")
  .version("1.0.0");

program
  .requiredOption("-u, --url <url>", "Target URL to benchmark")
  .option("-a, --attempts <number>", "Number of requests per protocol", "20")
  .option("--latency <ms>", "Network latency in milliseconds", "0")
  .option("--download <mbps>", "Download speed in Mbps", "0")
  .option("--upload <mbps>", "Upload speed in Mbps", "0")
  .option("--offline", "Simulate offline mode")
  .option(
    "-o, --output <path>",
    "Output directory for results",
    "./benchmark-results",
  );

program.parse(process.argv);

const options = program.opts();

// Validation
if (!options.url) {
  console.error(`${colors.red}Error: URL is required${colors.nc}`);
  console.error("Usage: npm start -- -u https://example.com -a 50");
  process.exit(1);
}

try {
  new URL(options.url);
} catch (e) {
  console.error(`${colors.red}Error: Invalid URL format${colors.nc}`);
  process.exit(1);
}

// Parse options
const attempts = parseInt(options.attempts) || 20;
const latency = parseInt(options.latency) || 0;
const downloadMbps = parseInt(options.download) || 0;
const uploadMbps = parseInt(options.upload) || 0;

// Convert Mbps to bytes per second
const downloadThroughput =
  downloadMbps > 0 ? downloadMbps * 1024 * 1024 : undefined;
const uploadThroughput = uploadMbps > 0 ? uploadMbps * 1024 * 1024 : undefined;

const networkOptions: NetworkOptions = {
  offline: options.offline || false,
  latency: latency > 0 ? latency : undefined,
  downloadThroughput: downloadThroughput,
  uploadThroughput: uploadThroughput,
};

const parsedUrl = new URL(options.url);
const FORCE_QUIC_ON = `${parsedUrl.hostname}:${parsedUrl.port || 443}`;

async function main() {
  printHeader("HTTP/2 vs HTTP/3 BENCHMARK");

  console.log(`  URL: ${options.url}`);
  console.log(`  Attempts per protocol: ${attempts}`);

  const networkParts = [];
  if (options.offline) networkParts.push("OFFLINE");
  if (latency > 0) networkParts.push(`${latency}ms latency`);
  if (downloadMbps > 0) networkParts.push(`${downloadMbps} Mbps down`);
  if (uploadMbps > 0) networkParts.push(`${uploadMbps} Mbps up`);
  console.log(
    `  Network: ${networkParts.length > 0 ? networkParts.join(", ") : "Normal (no emulation)"}`,
  );

  console.log(`  QUIC forced for: ${FORCE_QUIC_ON}`);
  console.log();

  // HTTP/2
  console.log(`${colors.blue}▶️  Running HTTP/2 benchmark...${colors.nc}`);
  const bench2 = new PuppeteerBenchmark(networkOptions);
  const results2 = await bench2.run(attempts, options.url, false);
  console.log();

  // HTTP/3 (always enabled)
  console.log(`${colors.blue}▶️  Running HTTP/3 benchmark...${colors.nc}`);
  const bench3 = new PuppeteerBenchmark(networkOptions);
  const results3 = await bench3.run(attempts, options.url, true, FORCE_QUIC_ON);
  console.log();

  // Print results
  printResults(results2);
  printResults(results3);
  printComparison(results2, results3);

  // Timeouts
  printSubheader("TIMEOUTS", colors.yellow);
  console.log(`  HTTP/2: ${results2.timeoutCount} of ${attempts}`);
  console.log(`  HTTP/3: ${results3.timeoutCount} of ${attempts}`);
  console.log();

  printSeparator();
  console.log();

  // Save results
  const outputDir = options.output || "./benchmark-results";
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const hostname = new URL(options.url).hostname;
  const outputFile = join(outputDir, `benchmark-${hostname}-${timestamp}.json`);

  const report = {
    config: {
      url: options.url,
      attempts: attempts,
      network: {
        offline: options.offline || false,
        latency_ms: latency,
        download_mbps: downloadMbps,
        upload_mbps: uploadMbps,
      },
      force_quic_on: FORCE_QUIC_ON,
    },
    timestamp: new Date().toISOString(),
    comparison: {
      winner:
        results2.avgTime < results3.avgTime
          ? "HTTP/2"
          : results3.avgTime < results2.avgTime
            ? "HTTP/3"
            : "equal",
      http2_avg: results2.avgTime,
      http3_avg: results3.avgTime,
      speed_diff_percent:
        results2.avgTime < results3.avgTime
          ? ((results3.avgTime - results2.avgTime) / results2.avgTime) * 100
          : ((results2.avgTime - results3.avgTime) / results3.avgTime) * 100,
    },
    http2: {
      successful: results2.successful,
      failed: results2.failed,
      avgTime: results2.avgTime,
      p50: results2.p50,
      p90: results2.p90,
      p99: results2.p99,
      errors: results2.detailedErrors,
    },
    http3: {
      successful: results3.successful,
      failed: results3.failed,
      avgTime: results3.avgTime,
      p50: results3.p50,
      p90: results3.p90,
      p99: results3.p99,
      errors: results3.detailedErrors,
    },
  };

  writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(`📊  Results saved to: ${outputFile}`);

  console.log(
    `\n${colors.yellow}Total errors: HTTP/2 - ${results2.detailedErrors.length}, HTTP/3 - ${results3.detailedErrors.length}${colors.nc}`,
  );
}

main().catch((error) => {
  console.error(`${colors.red}FATAL ERROR:${colors.nc}`, error);
  process.exit(1);
});
