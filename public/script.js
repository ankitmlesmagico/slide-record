document.getElementById('recordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const slideUrl = document.getElementById('slideUrl').value;
    const timingsInput = document.getElementById('timings').value;
    const startBtn = document.getElementById('startBtn');
    const status = document.getElementById('status');
    const result = document.getElementById('result');
    
    // Parse timings
    const timings = timingsInput.split(',').map(t => parseFloat(t.trim())).filter(t => !isNaN(t));
    
    if (timings.length === 0) {
        showError('Please enter valid timing values');
        return;
    }
    
    // Show loading state
    startBtn.disabled = true;
    startBtn.textContent = 'Recording...';
    showStatus('Starting recording process...', 'loading');
    result.classList.add('hidden');
    
    try {
        const response = await fetch('/record', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                slideUrl,
                timings
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showResult(data.downloadUrl);
            status.classList.add('hidden');
        } else {
            showError(data.error || 'Recording failed');
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    } finally {
        startBtn.disabled = false;
        startBtn.textContent = 'Start Recording';
    }
});

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    status.classList.remove('hidden');
}

function showError(message) {
    showStatus(message, 'error');
}

function showResult(downloadUrl) {
    const result = document.getElementById('result');
    const downloadLink = document.getElementById('downloadLink');
    
    downloadLink.href = downloadUrl;
    downloadLink.download = 'slideshow-recording.mp4';
    result.classList.remove('hidden');
}