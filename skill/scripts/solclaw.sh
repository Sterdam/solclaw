#!/bin/bash

# SolClaw CLI - Agent-to-Agent USDC Payments
# Usage: solclaw.sh <command> [options]

API_BASE="${SOLCLAW_API:-https://solclaw.xyz}"

show_help() {
    echo "SolClaw CLI - Send USDC by agent name on Solana"
    echo ""
    echo "Usage: solclaw <command> [options]"
    echo ""
    echo "Commands:"
    echo "  register <name> <wallet>    Register an agent name"
    echo "  send <from> <to> <amount>   Send USDC to another agent"
    echo "  balance <name>              Check agent balance"
    echo "  resolve <name>              Resolve name to addresses"
    echo "  agents                      List all registered agents"
    echo "  leaderboard                 Show top agents"
    echo "  history <name>              Show transaction history"
    echo ""
    echo "Environment:"
    echo "  SOLCLAW_API    API base URL (default: https://solclaw.xyz)"
    echo ""
    echo "Examples:"
    echo "  solclaw register MyAgent 8nyU2Hrvr5Ew14vx863grbiWPkPZ1sUhroSVFuXojqXk"
    echo "  solclaw send MyAgent Nyx_Bot 5"
    echo "  solclaw balance MyAgent"
}

case "$1" in
    register)
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo "Usage: solclaw register <name> <wallet>"
            exit 1
        fi
        curl -s -X POST "$API_BASE/api/register" \
            -H "Content-Type: application/json" \
            -d "{\"name\": \"$2\", \"wallet\": \"$3\"}" | jq .
        ;;

    send)
        if [ -z "$2" ] || [ -z "$3" ] || [ -z "$4" ]; then
            echo "Usage: solclaw send <from> <to> <amount>"
            exit 1
        fi
        curl -s -X POST "$API_BASE/api/send" \
            -H "Content-Type: application/json" \
            -d "{\"from\": \"$2\", \"to\": \"$3\", \"amount\": $4}" | jq .
        ;;

    balance)
        if [ -z "$2" ]; then
            echo "Usage: solclaw balance <name>"
            exit 1
        fi
        curl -s "$API_BASE/api/balance/$2" | jq .
        ;;

    resolve)
        if [ -z "$2" ]; then
            echo "Usage: solclaw resolve <name>"
            exit 1
        fi
        curl -s "$API_BASE/api/resolve/$2" | jq .
        ;;

    agents)
        curl -s "$API_BASE/api/agents" | jq .
        ;;

    leaderboard)
        curl -s "$API_BASE/api/leaderboard" | jq .
        ;;

    history)
        if [ -z "$2" ]; then
            echo "Usage: solclaw history <name>"
            exit 1
        fi
        curl -s "$API_BASE/api/history/$2" | jq .
        ;;

    help|--help|-h)
        show_help
        ;;

    *)
        show_help
        exit 1
        ;;
esac
