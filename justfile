[private]
default:
    @just --list

check:
    npm run format:check
    npm run check
    npm test
    npm run build

dev:
    npm run dev

preview:
    npm run build
    npm run preview

fmt:
    npm run format
