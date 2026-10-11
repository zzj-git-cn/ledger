@echo off
setlocal
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
if "%REPO%"=="" (
  echo.
  echo 请粘贴你的仓库地址,例:https://github.com/zzj-git-cn/ledger.git
  set /p "REPO=仓库地址: "
)
if not "%REPO%"=="" (
  git remote remove origin >nul 2>&1
  git remote add origin "%REPO%"
  echo [4/5] 已设置远程仓库
) else (
  echo [4/5] 没填地址,使用已有 origin
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
  echo   1. GitHub 上还没建仓库 - 先去网页建一个空仓库,别勾选 README
  echo   2. 网络问题 - 把 Watt Toolkit 打开再试
  echo   3. 证书问题 - 在 cmd 里执行下面这行,然后重开本脚本:
  echo        git config --global http.sslBackend openssl
  echo --------------------------------------------
) else (
  echo.
  echo 推送成功!
  echo 仓库地址: %REPO%
  echo 想去网页看效果:Settings -^> Pages -^> Source 选 main -^> Save
)
echo.
pause
