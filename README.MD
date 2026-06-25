# HTTP/2 vs HTTP/3 Benchmark

Benchmark to compare HTTP/2 and HTTP/3 with Puppeteer.

HTTP/3 is forced for the target URL even if no Alt-Svc header is received.

## 📋 Requirements

- Node.js 26+ (or Docker)
- 2 GB RAM
- 1 GB of free disk space

## 🚀 Quick Start

### Local Installation

```bash
git clone https://github.com/jehy/http3-benchmark/
cd http3-benchmark
npm install
```

### Running

#### Local Run

```bash
npm start -- -u https://example.com
npm start -- -u https://example.com -a 50 --latency 100 --download 1.5
npm start -- -u https://example.com --offline
```

#### Running with Docker (Node.js 26)

From a prepared image:

```bash
docker run ghcr.io/jehy/http3-benchmark  -a 10 -u https://example.com
```

Building from source:

```bash
docker build -t http3-benchmark .
docker run --rm http3-benchmark -u https://example.com
docker run --rm http3-benchmark -u https://example.com -a 50 --latency 100 --download 1.5
docker run --rm -v $(pwd)/benchmark-results:/app/benchmark-results http3-benchmark -u https://example.com -a 30
```

### 📊 Command-Line Options

```
Option	Description	Default	Example
-u, --url <url>	Required. URL to test	-	https://example.com
-a, --attempts <number>	Number of requests per protocol	20	50
--latency <ms>	Artificial network latency in ms	0	100
--download <mbps>	Download speed limit in Mbps	0	1.5
--upload <mbps>	Upload speed limit in Mbps	0	0.75
--offline	Simulate offline mode	false	--offline
-o, --output <path>	Directory for saving results	./benchmark-results	./my-results
```

### 📈 Usage Examples

```bash
# Standard test
npm start -- -u https://serial-wod.ru -a 30

# Test with 3G network emulation
npm start -- -u https://serial-wod.ru -a 50 --latency 100 --download 1.5 --upload 0.75

# Test with 4G network emulation
npm start -- -u https://serial-wod.ru -a 100 --latency 50 --download 20 --upload 10

# Test with weak Wi-Fi emulation
npm start -- -u https://serial-wod.ru -a 30 --latency 20 --download 5 --upload 2
```

### 📁 Results

Results are saved in JSON format to the benchmark-results/ directory:

```json
{
  "config": {
    "url": "https://example.com",
    "attempts": 20,
    "network": {
      "latency_ms": 100,
      "download_mbps": 1.5,
      "upload_mbps": 0.75
    }
  },
  "timestamp": "2024-01-01T12-00-00.000Z",
  "comparison": {
    "winner": "HTTP/3",
    "http2_avg": 0.5671,
    "http3_avg": 0.5123,
    "speed_diff_percent": 9.66
  },
  "http2": {
    "successful": 20,
    "failed": 0,
    "avgTime": 0.5671,
    "p50": 0.5597,
    "p90": 0.6989,
    "p99": 0.7302
  },
  "http3": {
    "successful": 20,
    "failed": 0,
    "avgTime": 0.5123,
    "p50": 0.4980,
    "p90": 0.6102,
    "p99": 0.6431
  }
}
```

### 🐛 Troubleshooting

##### Puppeteer Does Not Start in Docker

```bash
docker run --rm http3-benchmark -u https://example.com --no-sandbox --disable-setuid-sandbox
```

##### "Connection refused" Error

```bash
curl -I https://example.com
```

### 📦 Development

```bash
npm install --include=dev
npm run dev -- -u https://example.com
npm run build
npm test
```

## 📄 License

MIT
