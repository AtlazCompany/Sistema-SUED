$ErrorActionPreference = "Continue"

$Root = (Get-Location).Path
$AuditDir = Join-Path $Root "audit"
$Report = Join-Path $AuditDir "SUED-AUDIT-REPORT.txt"

New-Item -ItemType Directory -Force $AuditDir | Out-Null

function Section($title) {
    Add-Content $Report ""
    Add-Content $Report ("=" * 80)
    Add-Content $Report $title
    Add-Content $Report ("=" * 80)
}

function WriteResult($text) {
    Add-Content $Report $text
}

Set-Content $Report @"
SUED SYSTEM — AUDITORIA AUTOMÁTICA
Data: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Diretório: $Root

IMPORTANTE:
Esta auditoria é SOMENTE LEITURA.
Nenhum arquivo do projeto será alterado.

"@

# ============================================================
# 1. ESTRUTURA
# ============================================================

Section "1. ESTRUTURA DO PROJETO"

$importantPaths = @(
    "package.json",
    "package-lock.json",
    "vercel.json",
    ".env",
    ".env.local",
    ".env.example",
    "public",
    "public/index.html",
    "public/src",
    "server",
    "server/auth.js",
    "server/utils.js",
    "server/config.js",
    "server/supabaseClient.js"
)

foreach ($path in $importantPaths) {
    $full = Join-Path $Root $path

    if (Test-Path $full) {
        WriteResult "[OK] $path"
    }
    else {
        WriteResult "[AUSENTE] $path"
    }
}

# ============================================================
# 2. PACKAGE.JSON
# ============================================================

Section "2. PACKAGE.JSON"

$packagePath = Join-Path $Root "package.json"

if (Test-Path $packagePath) {
    try {
        $pkg = Get-Content $packagePath -Raw | ConvertFrom-Json

        WriteResult "Nome: $($pkg.name)"
        WriteResult "Versão: $($pkg.version)"
        WriteResult "Tipo: $($pkg.type)"

        WriteResult ""
        WriteResult "Scripts:"

        if ($pkg.scripts) {
            $pkg.scripts.PSObject.Properties | ForEach-Object {
                WriteResult "  $($_.Name) = $($_.Value)"
            }
        }

        WriteResult ""
        WriteResult "Dependências:"

        if ($pkg.dependencies) {
            $pkg.dependencies.PSObject.Properties | ForEach-Object {
                WriteResult "  $($_.Name) = $($_.Value)"
            }
        }

        WriteResult ""
        WriteResult "DevDependencies:"

        if ($pkg.devDependencies) {
            $pkg.devDependencies.PSObject.Properties | ForEach-Object {
                WriteResult "  $($_.Name) = $($_.Value)"
            }
        }
    }
    catch {
        WriteResult "[ERRO] package.json inválido: $($_.Exception.Message)"
    }
}
else {
    WriteResult "[ERRO] package.json não encontrado."
}

# ============================================================
# 3. NPM AUDIT
# ============================================================

Section "3. NPM AUDIT"

if (Test-Path $packagePath) {

    try {
        $npmVersion = npm --version 2>&1
        WriteResult "npm: $npmVersion"
    }
    catch {
        WriteResult "[ERRO] npm não encontrado."
    }

    try {
        WriteResult ""
        WriteResult "Executando npm audit..."
        WriteResult ""

        $auditOutput = npm audit --json 2>&1
        $auditFile = Join-Path $AuditDir "npm-audit.json"

        $auditOutput | Out-File $auditFile -Encoding utf8

        try {
            $auditJson = $auditOutput | ConvertFrom-Json

            if ($auditJson.metadata) {
                WriteResult "Vulnerabilidades:"
                WriteResult "  Critical: $($auditJson.metadata.vulnerabilities.critical)"
                WriteResult "  High:     $($auditJson.metadata.vulnerabilities.high)"
                WriteResult "  Moderate: $($auditJson.metadata.vulnerabilities.moderate)"
                WriteResult "  Low:      $($auditJson.metadata.vulnerabilities.low)"
                WriteResult "  Total:    $($auditJson.metadata.vulnerabilities.total)"
            }
        }
        catch {
            WriteResult "npm audit executado, mas o JSON não pôde ser resumido."
        }
    }
    catch {
        WriteResult "[ERRO] npm audit falhou: $($_.Exception.Message)"
    }
}

# ============================================================
# 4. ARQUIVOS .ENV
# ============================================================

Section "4. VARIÁVEIS DE AMBIENTE / SEGREDOS"

$envFiles = Get-ChildItem -Path $Root -Recurse -Force -File `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -match '^\.env($|\.)'
    }

if ($envFiles) {
    foreach ($file in $envFiles) {
        $relative = $file.FullName.Substring($Root.Length + 1)

        WriteResult "[ENCONTRADO] $relative"

        $lines = Get-Content $file.FullName -ErrorAction SilentlyContinue

        foreach ($line in $lines) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
                $name = $matches[1]

                if ($name -match '(SECRET|PASSWORD|TOKEN|KEY|PRIVATE|DATABASE_URL)') {
                    WriteResult "  [SENSÍVEL] $name = [OCULTO]"
                }
                else {
                    WriteResult "  $name"
                }
            }
        }
    }
}
else {
    WriteResult "Nenhum arquivo .env encontrado no projeto."
}

# ============================================================
# 5. POSSÍVEIS SEGREDOS NO CÓDIGO
# ============================================================

Section "5. POSSÍVEIS SEGREDOS NO CÓDIGO"

$sourceFiles = Get-ChildItem -Path $Root -Recurse -File `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch '\\node_modules\\' -and
        $_.FullName -notmatch '\\\.git\\' -and
        $_.FullName -notmatch '\\audit\\' -and
        $_.Extension -in @(
            ".js",".jsx",".ts",".tsx",".json",".env",
            ".html",".css",".sql"
        )
    }

$secretPatterns = @(
    'sk-[A-Za-z0-9_-]{20,}',
    'api[_-]?key\s*[:=]',
    'secret\s*[:=]',
    'password\s*[:=]',
    'jwt[_-]?secret\s*[:=]',
    'DATABASE_URL\s*[:=]'
)

foreach ($file in $sourceFiles) {

    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue

    foreach ($pattern in $secretPatterns) {

        if ($content -match $pattern) {

            $relative = $file.FullName.Substring($Root.Length + 1)

            WriteResult "[ATENÇÃO] Possível segredo em: $relative"
            WriteResult "  Padrão detectado: $pattern"
        }
    }
}

# ============================================================
# 6. FETCH DIRETO
# ============================================================

Section "6. FETCH DIRETO NO FRONTEND"

$frontendFiles = Get-ChildItem (Join-Path $Root "public") -Recurse -File `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Extension -in @(".js",".jsx",".ts",".tsx")
    }

foreach ($file in $frontendFiles) {

    $matches = Select-String `
        -Path $file.FullName `
        -Pattern '\bfetch\s*\(' `
        -SimpleMatch:$false `
        -ErrorAction SilentlyContinue

    foreach ($match in $matches) {

        $relative = $file.FullName.Substring($Root.Length + 1)

        WriteResult "[FETCH] $relative : linha $($match.LineNumber)"
        WriteResult "  $($match.Line.Trim())"
    }
}

# ============================================================
# 7. ROTAS DA API
# ============================================================

Section "7. ROTAS BACKEND"

$serverFiles = Get-ChildItem (Join-Path $Root "server") -Recurse -File `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Extension -in @(".js",".mjs",".ts")
    }

foreach ($file in $serverFiles) {

    $lines = Get-Content $file.FullName -ErrorAction SilentlyContinue

    for ($i = 0; $i -lt $lines.Count; $i++) {

        if ($lines[$i] -match '\.(get|post|put|patch|delete)\s*\(') {

            $relative = $file.FullName.Substring($Root.Length + 1)

            WriteResult "$relative : linha $($i + 1)"
            WriteResult "  $($lines[$i].Trim())"
        }
    }
}

# ============================================================
# 8. AUTENTICAÇÃO
# ============================================================

Section "8. AUTENTICAÇÃO / JWT / COOKIE"

$authPath = Join-Path $Root "server\auth.js"

if (Test-Path $authPath) {

    $auth = Get-Content $authPath -Raw

    if ($auth -match 'httpOnly\s*:\s*true') {
        WriteResult "[OK] Cookie httpOnly encontrado."
    }
    else {
        WriteResult "[RISCO] Cookie sem httpOnly detectado."
    }

    if ($auth -match 'sameSite\s*:\s*"lax"') {
        WriteResult "[OK] SameSite=Lax."
    }
    else {
        WriteResult "[ATENÇÃO] SameSite não identificado como Lax."
    }

    if ($auth -match 'secure\s*:\s*config\.isProd') {
        WriteResult "[OK] Secure condicionado à produção."
    }
    else {
        WriteResult "[ATENÇÃO] Configuração Secure do cookie deve ser revisada."
    }

    if ($auth -match 'bcrypt') {
        WriteResult "[OK] bcrypt utilizado para senha."
    }
    else {
        WriteResult "[RISCO] bcrypt não identificado no auth.js."
    }

    if ($auth -match 'jwt\.sign') {
        WriteResult "[OK] JWT utilizado."
    }
    else {
        WriteResult "[ATENÇÃO] JWT não identificado."
    }

}
else {
    WriteResult "[ERRO] server/auth.js não encontrado."
}

# ============================================================
# 9. RBAC
# ============================================================

Section "9. RBAC / PERMISSÕES"

$rolesPath = Join-Path $Root "public\src\roles.js"

if (Test-Path $rolesPath) {

    WriteResult "roles.js encontrado."

    $rolesContent = Get-Content $rolesPath -Raw

    foreach ($role in @(
        "ADMIN",
        "SOCIO",
        "COMERCIAL",
        "OPERACIONAL",
        "FINANCEIRO"
    )) {

        if ($rolesContent -match $role) {
            WriteResult "[OK] Papel encontrado: $role"
        }
        else {
            WriteResult "[AUSENTE] Papel não encontrado: $role"
        }
    }

}
else {
    WriteResult "[ERRO] roles.js não encontrado."
}

WriteResult ""
WriteResult "Rotas sem requireRole potencialmente relevantes:"

foreach ($file in $serverFiles) {

    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue

    if (
        $content -match 'Router\(' -and
        $content -match '\.(get|post|put|patch|delete)\s*\('
    ) {

        if (
            $content -notmatch 'requireRole' -and
            $content -notmatch 'authRouter'
        ) {

            $relative = $file.FullName.Substring($Root.Length + 1)

            WriteResult "[REVISAR] $relative"
        }
    }
}

# ============================================================
# 10. DELETE
# ============================================================

Section "10. OPERAÇÕES DELETE"

foreach ($file in $serverFiles) {

    $lines = Get-Content $file.FullName -ErrorAction SilentlyContinue

    for ($i = 0; $i -lt $lines.Count; $i++) {

        if ($lines[$i] -match '\.delete\s*\(') {

            $relative = $file.FullName.Substring($Root.Length + 1)

            WriteResult "[DELETE] $relative : linha $($i + 1)"
            WriteResult "  $($lines[$i].Trim())"
        }
    }
}

# ============================================================
# 11. TRANSAÇÕES
# ============================================================

Section "11. TRANSAÇÕES SQL"

foreach ($file in $serverFiles) {

    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue

    if ($content -match 'sql\.begin') {

        $relative = $file.FullName.Substring($Root.Length + 1)

        WriteResult "[TRANSAÇÃO] $relative"
    }
}

# ============================================================
# 12. PROBLEMAS DE ID / NUMBER
# ============================================================

Section "12. PADRÕES POTENCIALMENTE PROBLEMÁTICOS"

$patterns = @{
    "count(*) + 1" = 'count\s*\(\s*\*\s*\)[^;\n]*\+\s*1'
    "Math.random" = 'Math\.random'
    "localStorage token" = 'localStorage[^;\n]*(token|jwt|auth)'
    "sessionStorage token" = 'sessionStorage[^;\n]*(token|jwt|auth)'
    "eval" = '\beval\s*\('
    "innerHTML" = '\.innerHTML\s*='
}

foreach ($item in $patterns.GetEnumerator()) {

    WriteResult ""
    WriteResult "PADRÃO: $($item.Key)"

    $found = $false

    foreach ($file in $sourceFiles) {

        $matches = Select-String `
            -Path $file.FullName `
            -Pattern $item.Value `
            -ErrorAction SilentlyContinue

        foreach ($match in $matches) {

            $found = $true

            $relative = $file.FullName.Substring($Root.Length + 1)

            WriteResult "  [REVISAR] $relative : linha $($match.LineNumber)"
            WriteResult "    $($match.Line.Trim())"
        }
    }

    if (-not $found) {
        WriteResult "  Nenhum encontrado."
    }
}

# ============================================================
# 13. SQL / QUERIES
# ============================================================

Section "13. QUERIES SQL E INPUTS"

foreach ($file in $serverFiles) {

    $lines = Get-Content $file.FullName -ErrorAction SilentlyContinue

    for ($i = 0; $i -lt $lines.Count; $i++) {

        if (
            $lines[$i] -match 'req\.params' -or
            $lines[$i] -match 'req\.body'
        ) {

            $relative = $file.FullName.Substring($Root.Length + 1)

            WriteResult "$relative : linha $($i + 1)"
            WriteResult "  $($lines[$i].Trim())"
        }
    }
}

# ============================================================
# 14. VERCEL
# ============================================================

Section "14. VERCEL"

$vercelPath = Join-Path $Root "vercel.json"

if (Test-Path $vercelPath) {

    WriteResult "[OK] vercel.json encontrado."

    try {
        $vercel = Get-Content $vercelPath -Raw | ConvertFrom-Json

        if ($vercel.rewrites) {
            WriteResult "[OK] rewrites encontrados."
        }

        if ($vercel.headers) {
            WriteResult "[OK] headers de segurança encontrados."
        }
        else {
            WriteResult "[ATENÇÃO] Nenhum header de segurança encontrado."
        }
    }
    catch {
        WriteResult "[ERRO] vercel.json inválido."
    }

}
else {
    WriteResult "[AUSENTE] vercel.json"
}

# ============================================================
# 15. INDEX
# ============================================================

Section "15. INDEX.HTML"

$indexPath = Join-Path $Root "public\index.html"

if (Test-Path $indexPath) {

    $index = Get-Content $indexPath -Raw

    if ($index -match '<meta\s+charset=') {
        WriteResult "[OK] charset."
    }

    if ($index -match 'viewport') {
        WriteResult "[OK] viewport."
    }

    if ($index -match '<title>') {
        WriteResult "[OK] title."
    }

    if ($index -match 'fonts.googleapis.com') {
        WriteResult "[INFO] Google Fonts utilizado."
    }

}
else {
    WriteResult "[AUSENTE] public/index.html"
}

# ============================================================
# 16. TAMANHO DO PROJETO
# ============================================================

Section "16. TAMANHO DO PROJETO"

$allFiles = Get-ChildItem $Root -Recurse -File `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch '\\\.git\\'
    }

WriteResult "Arquivos: $($allFiles.Count)"

$size = ($allFiles | Measure-Object Length -Sum).Sum

if ($size) {
    WriteResult "Tamanho total: $([math]::Round($size / 1MB, 2)) MB"
}

$nodeModules = Get-ChildItem $Root -Directory -Force `
    -ErrorAction SilentlyContinue |
    Where-Object Name -eq "node_modules"

if ($nodeModules) {
    WriteResult "[INFO] node_modules presente."
}

# ============================================================
# 17. GIT
# ============================================================

Section "17. GIT"

if (Test-Path (Join-Path $Root ".git")) {

    WriteResult "[OK] Repositório Git encontrado."

    try {
        $branch = git branch --show-current 2>&1
        WriteResult "Branch: $branch"

        WriteResult ""
        WriteResult "Status:"
        git status --short 2>&1 | ForEach-Object {
            WriteResult $_
        }

    }
    catch {
        WriteResult "[ATENÇÃO] Git não pôde ser consultado."
    }

}
else {
    WriteResult "[ATENÇÃO] .git não encontrado."
}

# ============================================================
# FINAL
# ============================================================

Section "FIM DA AUDITORIA"

WriteResult ""
WriteResult "Relatório gerado em:"
WriteResult $Report
WriteResult ""
WriteResult "IMPORTANTE:"
WriteResult "Este relatório NÃO significa que todos os itens encontrados são erros."
WriteResult "Os resultados precisam ser analisados antes de qualquer alteração."

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " AUDITORIA DO SUED SYSTEM CONCLUÍDA" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Relatório:" -ForegroundColor Yellow
Write-Host $Report -ForegroundColor White
Write-Host ""

Write-Host "Abrindo relatório..." -ForegroundColor Cyan

notepad $Report