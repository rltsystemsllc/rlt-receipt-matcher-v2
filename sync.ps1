# RLT Sync Script
# Run this to check and sync your code to Railway

Write-Host "`n🔍 Checking code status..." -ForegroundColor Cyan

# Check for uncommitted changes
$status = git status --porcelain
if ($status) {
    Write-Host "`n⚠️  Uncommitted changes found:" -ForegroundColor Yellow
    git status --short
    
    $confirm = Read-Host "`nPush these changes? [y/n]"
    if ($confirm -eq 'y') {
        $message = Read-Host "Commit message"
        if (-not $message) { $message = "Update $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
        
        git add -A
        git commit -m $message
        git push origin main
        
        Write-Host "`n✅ Pushed to Git! Railway will deploy in ~1-2 minutes." -ForegroundColor Green
    }
} else {
    Write-Host "✅ Local code is clean (no uncommitted changes)" -ForegroundColor Green
}

# Check if we're up to date with remote
git fetch origin main 2>$null
$behind = git rev-list HEAD..origin/main --count
$ahead = git rev-list origin/main..HEAD --count

if ($behind -gt 0) {
    Write-Host "⚠️  Local is $behind commits BEHIND remote. Run: git pull" -ForegroundColor Yellow
} elseif ($ahead -gt 0) {
    Write-Host "⚠️  Local is $ahead commits AHEAD of remote. Run: git push" -ForegroundColor Yellow
} else {
    Write-Host "✅ Local matches Git remote" -ForegroundColor Green
}

# Show recent commits
Write-Host "`n📜 Recent commits:" -ForegroundColor Cyan
git log --oneline -5

# Show Railway status
Write-Host "`n🚂 Railway URLs:" -ForegroundColor Cyan
Write-Host "   Dashboard: https://rlt-receipt-matcher-v2-production.up.railway.app/smart-receipt"
Write-Host "   Health:    https://rlt-receipt-matcher-v2-production.up.railway.app/health"

Write-Host ""

