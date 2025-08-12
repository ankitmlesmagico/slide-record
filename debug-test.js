const http = require('http');

const API_BASE = 'localhost';
const API_PORT = 3003;

// Test data
const testData = {
    slideUrl: 'https://docs.google.com/presentation/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    timings: [3, 6, 9]
};

function testEndpoint(path, data = null) {
    return new Promise((resolve, reject) => {
        const postData = data ? JSON.stringify(data) : null;
        
        const options = {
            hostname: API_BASE,
            port: API_PORT,
            path: path,
            method: data ? 'POST' : 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': postData ? Buffer.byteLength(postData) : 0
            }
        };

        console.log(`\n🔍 Testing ${options.method} ${path}`);
        if (postData) {
            console.log(`📤 Sending: ${postData}`);
        }

        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log(`📥 Status: ${res.statusCode}`);
                console.log(`📥 Response: ${data}`);
                
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data, raw: true });
                }
            });
        });

        req.on('error', (e) => {
            console.error(`❌ Request error: ${e.message}`);
            reject(e);
        });

        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

async function runTests() {
    console.log('🚀 Starting API Debug Tests\n');
    
    try {
        // Test 1: Health check
        console.log('='.repeat(50));
        await testEndpoint('/health');
        
        // Test 2: Test endpoint
        console.log('='.repeat(50));
        await testEndpoint('/test', { message: 'hello' });
        
        // Test 3: Record endpoint
        console.log('='.repeat(50));
        await testEndpoint('/record', testData);
        
        console.log('\n✅ All tests completed');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run tests
runTests();