# Sample GenLayer project
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/license/mit/)
[![Discord](https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white)](https://discord.gg/8Jm4v89VAu)
[![Telegram](https://img.shields.io/badge/Telegram--T.svg?style=social&logo=telegram)](https://t.me/genlayer)
[![Twitter](https://img.shields.io/twitter/url/https/twitter.com/yeagerai.svg?style=social&label=Follow%20%40GenLayer)](https://x.com/GenLayer)
[![GitHub star chart](https://img.shields.io/github/stars/yeagerai/genlayer-project-boilerplate?style=social)](https://star-history.com/#yeagerai/genlayer-js)

## 👀 About
This project includes the boilerplate code for a GenLayer use case implementation, specifically a football bets game.

## 📦 What's included
- Basic requirements to deploy and test your intelligent contracts locally
- Configuration file template
<!-- - Test functions to write complete end-to-end tests -->
- An example of an intelligent contract (Football Bets)
- Example end-to-end tests for the contract provided
- A production-ready Next.js 15 frontend with TypeScript, TanStack Query, and Radix UI

## 🛠️ Requirements
- Python 3.12 support for contracts and tests
- Node.js 18+ for the GenLayer CLI and frontend
- A running GenLayer Studio (Install from [Docs](https://docs.genlayer.com/developers/intelligent-contracts/tooling-setup#using-the-genlayer-studio) or work with the hosted version of [GenLayer Studio](https://studio.genlayer.com/)). If you are working locally, this repository code does not need to be located in the same directory as the Genlayer Studio.
- [GenLayer CLI](https://github.com/genlayerlabs/genlayer-cli) globally installed. To install or update the GenLayer CLI run `npm install -g genlayer`
- Optional: [uv](https://docs.astral.sh/uv/) for Python environment management

## 🐍 Python Environment

Use either a standard virtual environment or `uv` for the contract and test environment. The frontend and GenLayer CLI remain Node-based.

**Using `venv` + `pip`:**

```shell
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**Using `uv` (optional):**

```shell
uv sync
```

The optional `uv` workflow uses `.python-version` and `pyproject.toml` for the contract/test environment.
