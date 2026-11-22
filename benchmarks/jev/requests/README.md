# Synthetic sign-in fixtures

The last entry in `history.recent_login_attempts` is the current successful sign-in. Its timestamp, device, and network match the corresponding fields in `session`. Each scenario has two variants in [variants/](variants/).

| Base scenario | What the case exercises |
| --- | --- |
| [Routine](normal.json) | Familiar device, country, and local sign-in time. |
| [New country](new-country.json) | The first sign-in from Germany in the account's history. |
| [Off-hours](off-hours.json) | A 2 a.m. sign-in after a series of morning sign-ins in Dubai. |
| [Rapid country change](rapid-country-change.json) | Successful sign-ins from the UAE and Germany eight minutes apart. |
| [Thin history](thin-history.json) | One prior successful sign-in and missing current network details. |
| [VPN and access changes](vpn-and-access-changes.json) | An off-hours VPN sign-in from a new device after access changes and failed attempts. |

The comparison predefines acceptable probability bands for routine and VPN/access-change cases, including their variants. The other cases probe model behavior without a fixed probability band.
