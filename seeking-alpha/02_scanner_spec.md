# Scanner Spec: RWA Commodity Carry Mismatch

Date: 2026-05-02

## Assets

Initial scope:

```text
WTIOIL
BRENTOIL
NATGAS
COPPER
SILVER
GOLD
```

## Required Inputs

For each asset:

```text
asset
ostium_long_rollover_apr
ostium_short_rollover_apr
xyz_hourly_funding
xyz_annualized_funding
ostium_spread_bps
xyz_spread_bps
ostium_depth
xyz_depth
is_roll_window
is_external_market_open
oracle_source
max_leverage
estimated_daily_volatility
```

## Normalized Sign Convention

```text
xyz_hourly_funding > 0:
  longs pay shorts
  short trade[XYZ] receives

xyz_hourly_funding < 0:
  shorts pay longs
  long trade[XYZ] receives

ostium_rollover > 0:
  that side pays

ostium_rollover < 0:
  that side receives
```

## Edge Formulas

Strategy A:

```text
Long Ostium / Short trade[XYZ]

edge_A =
  (-ostium_long_rollover_apr)
+ (xyz_hourly_funding * 24 * 365)
- estimated_costs_apr
```

Strategy B:

```text
Short Ostium / Long trade[XYZ]

edge_B =
  (-ostium_short_rollover_apr)
+ (-xyz_hourly_funding * 24 * 365)
- estimated_costs_apr
```

## Candidate Filters

A trade is only a candidate if:

```text
net_edge > 20% APR
expected_holding_period >= 24h
entry_exit_cost < 10% of expected_edge
liquidation_buffer >= 5x expected_daily_volatility
spread is not extreme
OI and depth are sufficient
```

## Risk Multipliers

```text
is_roll_window = true:
  risk +2

is_external_market_open = false:
  risk +2

spread > 20 bps:
  reject unless net_edge is exceptional

funding spike duration < 1 hour:
  observe only

depth too low:
  reject
```

## Output Table

```text
asset
recommended_pair
edge_A
edge_B
best_edge
risk_score
final_score
status
notes
```

## Status Values

```text
ignore
watch
candidate
paper_trade
live_small
disabled
```
