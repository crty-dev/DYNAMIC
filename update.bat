@echo off
REM =============================================================================
REM  DYNAMIC - tek tikla guncelleme (kontrol ^> test ^> build ^> deploy ^> dogrulama)
REM
REM    update.bat                 tam dongu
REM    update.bat --skip-tests    testleri atla
REM    update.bat --no-deploy     sadece kontrol + build (yerel)
REM    update.bat --migrate       deploy oncesi uzak D1 migration'larini uygula
REM    update.bat --commit "mesaj" bitince degisiklikleri commit et
REM    update.bat --push          commit sonrasi remote'a push et
REM    update.bat --from build    sadece istenen adimdan itibaren calistir
REM
REM    Adimlar: deps ^> check ^> test ^> build ^> migrate ^> deploy ^> verify ^> commit ^> push
REM =============================================================================

setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "SKIP_TESTS=0"
set "SKIP_LINT=0"
set "DO_DEPLOY=1"
set "DO_MIGRATE=0"
set "DO_COMMIT=0"
set "DO_PUSH=0"
set "COMMIT_MSG="
set "FROM=deps"

:parse
if "%~1"=="" goto :parsed
if /I "%~1"=="--help" goto :help
if /I "%~1"=="-h" goto :help
if /I "%~1"=="--skip-tests" (
  set "SKIP_TESTS=1"
  shift
  goto :parse
)
if /I "%~1"=="--skip-lint" (
  set "SKIP_LINT=1"
  shift
  goto :parse
)
if /I "%~1"=="--no-deploy" (
  set "DO_DEPLOY=0"
  shift
  goto :parse
)
if /I "%~1"=="--migrate" (
  set "DO_MIGRATE=1"
  shift
  goto :parse
)
if /I "%~1"=="--commit" (
  set "DO_COMMIT=1"
  set "COMMIT_MSG=%~2"
  shift
  shift
  goto :parse
)
if /I "%~1"=="--push" (
  set "DO_PUSH=1"
  shift
  goto :parse
)
if /I "%~1"=="--from" (
  set "FROM=%~2"
  shift
  shift
  goto :parse
)
echo Bilinmeyen secenek: %~1
goto :usage_error

:parsed
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=chore: guncelleme"
if "%FROM%"=="" (
  echo   HATA: --from icin bir adim adi gerekli.
  goto :usage_error
)

echo.
echo  DYNAMIC - guncelleme
echo  ============================================================

call :require node
if errorlevel 1 goto :fail
call :require npm
if errorlevel 1 goto :fail

set "RUN=0"
for %%S in (deps check test build migrate deploy verify commit push) do (
  if /I "%%S"=="%FROM%" set "RUN=1"
  if "!RUN!"=="1" (
    call :do_%%S
    if errorlevel 1 goto :fail
  )
)

echo.
echo  ============================================================
echo  TAMAM. Her sey gonderildi.
echo  ============================================================
echo.
endlocal
exit /b 0

REM =============================================================================
REM  Adimlar
REM =============================================================================

:do_deps
call :banner "1/9" "Bagimliliklar"
if exist "node_modules" (
  echo   node_modules var, kurulum atlandi.
  echo   Zorlamak icin: npm install
) else (
  call npm install
  if errorlevel 1 exit /b 1
)
exit /b 0

:do_check
call :banner "2/9" "Tip kontrolu ve lint"
call npm run typecheck
if errorlevel 1 exit /b 1
if "%SKIP_LINT%"=="0" (
  call npm run lint
  if errorlevel 1 exit /b 1
) else (
  echo   lint atlandi
)
exit /b 0

:do_test
call :banner "3/9" "Testler"
if "%SKIP_TESTS%"=="1" (
  echo   testler atlandi
  exit /b 0
)
call npm test
if errorlevel 1 exit /b 1
exit /b 0

:do_build
call :banner "4/9" "Production build"
call npm run build
if errorlevel 1 exit /b 1
exit /b 0

:do_migrate
call :banner "5/9" "D1 migration (uzak)"
if "%DO_MIGRATE%"=="1" (
  call npm run db:migrate:remote
  if errorlevel 1 exit /b 1
) else (
  echo   migration atlandi. Uygulamak icin: update.bat --migrate
)
exit /b 0

:do_deploy
call :banner "6/9" "Deploy"
if "%DO_DEPLOY%"=="0" (
  echo   deploy atlandi - --no-deploy
  exit /b 0
)
call npx wrangler deploy
if errorlevel 1 exit /b 1
exit /b 0

:do_verify
call :banner "7/9" "Canli kontrol"
if "%DO_DEPLOY%"=="0" (
  echo   deploy yapilmadi, canli kontrol atlandi
  exit /b 0
)
call :health https://dynamic.crty-dev.com/api/health
if errorlevel 1 exit /b 1
call :health https://dynamic.crty-dev.com/api/auth/providers
if errorlevel 1 exit /b 1
call :health https://dynamic.crty-dev.com/app/login
if errorlevel 1 exit /b 1
exit /b 0

:do_commit
call :banner "8/9" "Git commit"
if "%DO_COMMIT%"=="0" (
  echo   commit atlandi. Yapmak icin: update.bat --commit "mesaj"
  exit /b 0
)
git add -A
if errorlevel 1 exit /b 1
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo   commit yapilamadi (degisiklik yoksa sorun degil)
  exit /b 0
)
echo   commit tamam
exit /b 0

:do_push
call :banner "9/9" "Git push"
if "%DO_PUSH%"=="0" (
  echo   push atlandi. Yapmak icin: update.bat --push
  exit /b 0
)
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo   UYARI: git remote 'origin' yok, push atlandi.
  echo   Once ekleyin: git remote add origin ^<repo-url^>
  exit /b 0
)
git push -u origin HEAD
if errorlevel 1 exit /b 1
echo   push tamam
exit /b 0

REM =============================================================================
REM  Yardimcilar
REM =============================================================================

:banner
echo.
echo  [%~1] %~2
echo  ------------------------------------------------------------
exit /b 0

:require
where %~1 >nul 2>&1
if errorlevel 1 (
  echo   HATA: %~1 bulunamadi. Node.js 20+ ve npm kurulu olmali.
  exit /b 1
)
exit /b 0

:health
curl -fsS --max-time 20 %~1 >nul
if errorlevel 1 (
  echo   HATA: %~1 yanit vermiyor.
  exit /b 1
)
echo   OK %~1
exit /b 0

:help
echo.
echo  DYNAMIC guncelleme betigi
echo.
echo    update.bat [--skip-tests] [--skip-lint] [--no-deploy]
echo              [--migrate] [--commit "mesaj"] [--push] [--from adim]
echo.
echo    --skip-tests   test paketini calistirma
echo    --skip-lint    oxlint calistirma
echo    --no-deploy    yalnizca kontrol + build
echo    --migrate      deploy oncesi uzak D1 migration'larini uygula
echo    --commit "m"   bitince degisiklikleri commit et
echo    --push         commit sonrasi remote'a push et
echo    --from adim    deps ^| check ^| test ^| build ^| migrate ^| deploy ^| verify
echo.
echo  Ornekler:
echo    update.bat
echo    update.bat --skip-tests --no-deploy
echo    update.bat --migrate --commit "feat: yeni ozellik" --push
echo.
endlocal
exit /b 0

:usage_error
echo.
echo  Bilinmeyen secenek. --help ile listeyi gorun.
echo.
endlocal
exit /b 1

:fail
echo.
echo  ============================================================
echo  BASARISIZ. Yukaridaki hatayi okuyun.
echo  ============================================================
echo.
endlocal
exit /b 1
