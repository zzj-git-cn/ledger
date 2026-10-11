@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title 记账本 - 推送到 GitHub

echo ============================================
echo   记账本 - 一键推送到 GitHub
echo ============================================
echo.

rem [1/5] 确认是 git 仓库
if not exist ".git" (
  git init -b main >nul 2>&1
  echo [1/5] 已初始化本地仓库
) else (
  echo [1/5] 本地仓库已存在
)

rem [2/5] 生成 index.html (GitHub Pages 入口)
copy /Y "记账本.html" "index.html" >nul
echo [2/5] 已生成 index.html

rem [3/5] 提交改动
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "更新记账本" >nul
  echo [3/5] 已提交本次改动
) else (
  echo [3/5] 没有新改动需要提交
)

rem [4/5] 远程仓库地址
set "REPO=%~1"
set "CUR="
for /f "delims=" %%i in ('git remote get-url origin 2^>nul') do set "CUR=%%i"
if not "%REPO%"=="" goto setremote
if defined CUR (
  echo [4/5] 当前远程仓库: !CUR!
  set /p "REPO=直接回车就用它,或粘贴新地址: "
  if not defined REPO set "REPO=!CUR!"
) else (
  echo.
  echo 请粘贴你的仓库地址,例:https://github.com/zzj-git-cn/ledger.git
  set /p "REPO=仓库地址: "
)

:setremote
if not "%REPO%"=="" (
  git remote remove origin >nul 2>&1
  git remote add origin "%REPO%"
  echo     已设置远程仓库
)
git branch -M main >nul 2>&1

rem [5/5] 推送
echo [5/5] 开始推送...
echo.
echo 【第一次推送会弹出 GitHub 登录窗口,登录一次以后就不用再登录了】
echo.
git push -u origin main
if errorlevel 1 (
  echo.
  echo --------------------------------------------
  echo 推送失败,常见原因:
  echo   1. 仓库还没建 - 先去 https://github.com/new 建一个空的公开仓库
  echo   2. 加速器问题 - Watt Toolkit 会替换 GitHub 证书;
  echo      若报证书或 schannel 错误,先在 Watt Toolkit 里停止加速再重跑
  echo   3. 实在不行临时跳过证书校验,在 cmd 里执行:
  echo        git config --global http.sslVerify false
  echo      推送成功后再改回:
  echo        git config --global http.sslVerify true
  echo --------------------------------------------
) else (
  echo.
  echo 推送成功!仓库地址: %REPO%
  echo.
  echo 想在网页上直接打开:
  echo   Settings -^> Pages -^> Source 选 main -^> Save
  echo   一分钟后访问 https://你的用户名.github.io/仓库名/
)
echo.
pause
