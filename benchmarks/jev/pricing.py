from dataclasses import dataclass
from decimal import Decimal

RATES_CHECKED_ON = "2026-11-21"
TOKENS_PER_MILLION = 1_000_000
# USD per million tokens, using uncached input and output rates.
JEV_INPUT_RATE = Decimal("0.042")
MINI_RATES = (Decimal("0.75"), Decimal("4.50"))
GPT_4O_RATES = (Decimal("2.50"), Decimal("10.00"))
OPENAI_STANDARD_RATES = {
    "gpt-4o": GPT_4O_RATES,
    "gpt-4o-2024-08-06": GPT_4O_RATES,
    "gpt-4o-2024-11-20": GPT_4O_RATES,
    "gpt-6-luna": (Decimal("0.10"), Decimal("0.50")),
    "gpt-5.4-mini": MINI_RATES,
    "gpt-5.4-mini-2026-03-17": MINI_RATES,
}
LUNA_LONG_CONTEXT_RATES = (Decimal("0.20"), Decimal("0.75"))


@dataclass(frozen=True)
class TokenCharge:
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal | None


def token_count(value):
    if type(value) is int and value >= 0:
        return value
    return None


def openai_cost(response, input_tokens, output_tokens):
    model = response.get("model")
    rates = OPENAI_STANDARD_RATES.get(model) if isinstance(model, str) else None
    if rates is None or response.get("service_tier") not in ("default", "standard"):
        return None
    if model == "gpt-6-luna" and input_tokens > 272_000:
        rates = LUNA_LONG_CONTEXT_RATES

    input_rate, output_rate = rates
    weighted_input_tokens = input_tokens
    details = response["usage"].get("prompt_tokens_details")
    if model == "gpt-6-luna" and isinstance(details, dict):
        cached_tokens = token_count(details.get("cached_tokens", 0))
        cache_write_tokens = token_count(details.get("cache_write_tokens", 0))
        if cached_tokens is None or cache_write_tokens is None:
            return None
        ordinary_tokens = input_tokens - cached_tokens - cache_write_tokens
        if ordinary_tokens < 0:
            return None
        weighted_input_tokens = (
            ordinary_tokens + cached_tokens * Decimal("0.10") + cache_write_tokens * Decimal("1.25")
        )
    return (weighted_input_tokens * input_rate + output_tokens * output_rate) / TOKENS_PER_MILLION


def charge_for(provider, response):
    if provider not in {"jev", "openai"}:
        return None
    usage = response.get("usage") if isinstance(response, dict) else None
    if not isinstance(usage, dict):
        return None
    input_tokens = token_count(usage.get("input_tokens", usage.get("prompt_tokens")))
    output_tokens = token_count(usage.get("output_tokens", usage.get("completion_tokens")))
    if input_tokens is None or output_tokens is None:
        return None

    if provider == "jev":
        cost = input_tokens * JEV_INPUT_RATE / TOKENS_PER_MILLION
        return TokenCharge(input_tokens, output_tokens, cost)

    cost = openai_cost(response, input_tokens, output_tokens)
    return TokenCharge(input_tokens, output_tokens, cost)
