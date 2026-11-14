# DoseKinetics

DoseKinetics is an offline drug concentration simulator for multiple dosing in the web browser. The program simulates single-compartment and two-compartment dosing, clears the body via the Cockcroft-Gault renal function equation, and ranks dosing regimens according to the target therapeutic window.

The software was created by Aariv Patel for the Human Health track at NorCal Hacks 27.

## Educational Scope Notice

None of the five presets found in `js/pk-engine.js` have any clinical relevance; they are simply learning tools. The program runs offline in your browser without any clinical patient data or network requests, and is not medical advice.

## What It Does

Single-compartment multiple dosing uses closed-form superposition for IV Bolus, Intermittent IV infusion, and Oral absorption. You may overlay a dose that was missed, doubled, or delayed using the dashed pink line.

Two-compartment simulation supports Central, Peripheral, and Depot compartments, which use the Runge-Kutta method to solve for microgram mass balance. Renal scaling estimates Devine IBW, Adjusted Body Weight, Creatinine Clearance, and patient Half-Life. The optimizer finds dose regimens inside MEC and MTC, computes loading doses, and outputs CSV or JSON files.

## Testing

```bash
node --test tests/
```

Thirty tests pass with `node --test tests/`.
