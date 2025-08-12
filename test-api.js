#!/usr/bin/env node

/**
 * Test client for the Slides Recording API
 * Usage: node test-api.js [slideUrl] [timings]
 */

const http = require('http');

const API_BASE = 'http://localhost:3002';

// Example usage
const EXAMPLE_URL = 'https://docs.google.com/presentation/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit';
const EXAMPLE_TIMINGS = [3, 6, 9, 12, 15];

async function makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3002,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    resolve({ status: res.statusCode, data: response });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function startRecording(slideUrl, timings) {
    console.log('🎬 Starting recording...');
    console.log(`📄 Slide URL: ${slideUrl}`);
    console.log(`⏱️  Timings: ${timings.join(', ')} seconds`);
    console.log('⏳ This will take some time, please wait...');
    console.log('');

    try {
        const response = await makeRequest('POST', '/api/record', {
            slideUrl,
            timings
        });

        if (response.status === 200) {
            console.log('✅ Recording completed successfully!');
            console.log(`🔗 Video URL: ${response.data.videoUrl}`);
            console.log(`📁 File name: ${response.data.fileName}`);
            console.log(`☁️ Stored in MinIO`);
            return response.data;
        } else {
            console.error('❌ Recording failed:');
            console.error(response.data);
            return null;
        }
    } catch (error) {
        console.error('❌ Error during recording:', error.message);
        return null;
    }
}

async function main() {
    const args = process.argv.slice(2);
    
    // Parse arguments for recording
    let slideUrl = args[0] || EXAMPLE_URL;
    let timings = EXAMPLE_TIMINGS;
    
    if (args[1]) {
        try {
            timings = args[1].split(',').map(t => parseFloat(t.trim()));
        } catch (e) {
            console.error('❌ Invalid timings format. Use comma-separated numbers like: 3,6,9,12');
            process.exit(1);
        }
    }
    
    console.log('🎬 Google Slides Recording API Test Client');
    console.log('==========================================');
    console.log('');
    
    // Start recording (this will wait until completion)
    const result = await startRecording(slideUrl, timings);
    
    if (!result) {
        console.log('💡 Make sure the server is running: npm run start:mac');
        process.exit(1);
    }
}

// Handle command line usage
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Unexpected error:', error);
        process.exit(1);
    });
}

module.exports = { makeRequest, startRecording };