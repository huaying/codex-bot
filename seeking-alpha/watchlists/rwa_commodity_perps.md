# Watchlist: RWA Commodity Perps

Date: 2026-05-02

## Priority Assets

### 1. WTIOIL

Why monitor:

- Energy markets have futures curve effects.
- WTI can move sharply on inventory, geopolitical, and macro headlines.
- Backwardation/contango can create meaningful rollover differences.

Target alpha:

```text
Ostium rollover direction
vs
trade[XYZ] funding direction
```

### 2. BRENTOIL

Why monitor:

- Similar to WTI but can diverge due to regional supply-demand shocks.
- Useful cross-check against WTI.

Target alpha:

```text
Brent-WTI spread behavior
+ venue funding mismatch
```

### 3. NATGAS

Why monitor:

- High volatility and seasonality.
- Potentially high funding and spread dislocations.

Risk:

- Can be too volatile for tight liquidation buffers.

### 4. COPPER

Why monitor:

- Macro-sensitive and China-sensitive.
- Industrial metal futures curve can shift with growth expectations.

Target alpha:

```text
futures curve shift
+ crypto perp crowding
```

### 5. SILVER

Why monitor:

- Metal with retail attention and thinner liquidity than gold.
- Can have stronger reflexive moves.

Target alpha:

```text
funding spikes
+ spot/perp premium
```

### 6. GOLD

Why monitor:

- Deepest and cleanest commodity RWA market.
- Good benchmark for whether scanner logic works.

Risk:

- Most efficient and likely more crowded.

## Research Notes

Gold may be the lowest alpha but best control market.

Oil, natgas, and copper are likely better alpha candidates because futures curve, roll window, and macro shocks matter more.
