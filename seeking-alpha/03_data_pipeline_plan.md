# Data Pipeline Plan

Date: 2026-05-02

## Goal

Build a repeatable scanner for RWA commodity perp carry mismatch.

The scanner should not make trade decisions by narrative. It should only flag markets when both legs of a delta-neutral pair potentially pay the portfolio after costs.

## Data Sources

### Hyperliquid / trade[XYZ]

Official docs:

- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
- https://docs.trade.xyz/

Useful Hyperliquid info endpoint request types:

```text
perpDexs
meta
metaAndAssetCtxs
l2Book
fundingHistory
perpsAtOpenInterestCap
perpDexStatus
```

For HIP-3 markets, coin names may need to be prefixed with the dex name, for example:

```text
xyz:XYZ100
```

Primary fields to extract:

```text
mark price
oracle price
current funding
open interest
max leverage
L2 orderbook depth
open interest caps
market status
```

### Ostium

Official docs:

- https://docs.ostium.com/protocol/how-ostium-works
- https://docs.ostium.com/traders/reference/fees

Primary fields to extract:

```text
long rollover APR
short rollover APR
opening fee
spread / effective quote
available depth
market status
max leverage
oracle source
```

If Ostium does not expose all fields through a stable public API, the fallback is:

1. Use official app/API if available.
2. Use subgraph or contract reads if documented.
3. Manually record UI values for paper-trading until API access is confirmed.

## Scanner Stages

### Stage 1: Discovery

```text
Fetch all available RWA perp markets
Filter to commodities
Map venue asset symbols to canonical assets
```

Canonical assets:

```text
WTIOIL
BRENTOIL
NATGAS
COPPER
SILVER
GOLD
```

### Stage 2: Normalization

Normalize rate signs:

```text
trade[XYZ] funding > 0:
  shorts receive

trade[XYZ] funding < 0:
  longs receive

Ostium rollover < 0:
  that side receives
```

Normalize rates to APR:

```text
xyz_funding_apr = xyz_hourly_funding * 24 * 365
```

### Stage 3: Edge Calculation

```text
edge_A = Long Ostium / Short trade[XYZ]

edge_A =
  (-ostium_long_rollover_apr)
+ xyz_funding_apr
- estimated_costs_apr
```

```text
edge_B = Short Ostium / Long trade[XYZ]

edge_B =
  (-ostium_short_rollover_apr)
- xyz_funding_apr
- estimated_costs_apr
```

### Stage 4: Risk Filters

Reject or downgrade when:

```text
spread is too wide
depth is too shallow
asset is in roll window
external market is closed
open interest is near venue cap
funding spike duration is less than 1 hour
expected edge is mostly eaten by entry/exit costs
liquidation buffer is too small
```

### Stage 5: Paper Trade Log

Every flagged opportunity should be logged before any live trade.

Required paper-trade fields:

```text
timestamp
asset
strategy_type
ostium_side
xyz_side
ostium_rollover_apr
xyz_funding_apr
estimated_costs_apr
net_edge_apr
entry_prices
exit_prices
holding_period
realized_pnl
realized_funding_or_rollover
failure_reason
```

## Next Implementation Step

Create a local prototype scanner that can:

1. Pull Hyperliquid/trade[XYZ] market contexts.
2. Normalize funding and OI.
3. Accept manually entered Ostium rollover data.
4. Produce a ranked table.

The first version can be read-only and paper-trade only.
