# Thesis: RWA Commodity Perps Carry Mismatch

Date: 2026-05-02

## One-line Thesis

RWA commodity perps may create alpha when two venues price the same underlying through different mechanisms: one venue prices real-world carry, while another prices crypto trader imbalance.

```text
Ostium pricing input:
  real-world carry / futures term structure / carry premium

trade[XYZ] pricing input:
  orderbook premium / hourly perp funding / oracle premium

Potential alpha:
  receive carry on one venue
+ receive funding on the hedge venue
- costs, spread, oracle, liquidation, and roll risk
```

## Venue Mechanism

### trade[XYZ]

trade[XYZ] is a Hyperliquid HIP-3 RWA perp venue.

Important mechanics:

- Commodity markets use external price sources.
- Metals can reference spot markets.
- Energy and industrial metals often require futures contracts because there is no clean single spot reference.
- Futures roll is performed during a fixed monthly roll window.
- Funding is classic perp funding:

```text
perp > oracle => longs pay shorts
perp < oracle => shorts pay longs
```

Funding is paid hourly.

### Ostium

Ostium uses rollover fees instead of classic perp funding.

Important mechanics:

- Rollover is based on real-world carry plus Ostium carry premium.
- Commodity carry depends on futures term structure.
- In backwardation, longs may receive rollover and shorts may pay.
- In contango, shorts may receive rollover and longs may pay.

## Core Strategy Shapes

### Strategy A: Long Ostium / Short trade[XYZ]

Use this when:

```text
Ostium long receives rollover
AND
trade[XYZ] shorts receive funding
```

This happens when:

```text
r_ostium_long < 0
f_xyz > 0
```

Expected edge:

```text
edge_A =
  (-r_ostium_long)
+ (f_xyz * 24 * 365)
- estimated_costs
```

### Strategy B: Short Ostium / Long trade[XYZ]

Use this when:

```text
Ostium short receives rollover
AND
trade[XYZ] longs receive funding
```

This happens when:

```text
r_ostium_short < 0
f_xyz < 0
```

Expected edge:

```text
edge_B =
  (-r_ostium_short)
+ (-f_xyz * 24 * 365)
- estimated_costs
```

## Why This Could Be Alpha

Public narratives say "RWA is hot." That is not alpha.

The real mechanism-level opportunity is:

```text
real-world commodity carry
diverges from
crypto perp positioning
```

If that divergence causes both legs of a hedge to pay the same portfolio, the trade may generate positive carry with reduced directional exposure.

## Main Risks

- Oracle mismatch between venues.
- External market close and reopening gaps.
- Futures contract roll effects.
- Shallow liquidity and spread costs.
- Liquidation risk if basis widens before it converges.
- RFQ/offchain hedge execution differences on Ostium.
- Orderbook and funding spikes on trade[XYZ].
