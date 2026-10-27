# SavoResQ - Demo test cases (same-pincode rule)

**Rule:** a hotel, an NGO and a donation only "see" each other when they share the same pincode.

## Before the demo
1. Start MongoDB, then in the project folder run:  `npm run seed`   (creates the demo accounts and food)
2. Start the app:  `npm start`  and open http://localhost:3000
3. Seed again if you demo later - the food expires in 40 min to 3 h.

All demo passwords: **Demo@1234**   (Admin: admin@savorresq.com / Admin@12345)

| Account (email) | Role | Pincode |
|---|---|---|
| green@demo.savoresq | Hotel - Green Leaf Hotel | 626001 (Sivakasi) |
| annapoorna@demo.savoresq | Hotel - Annapoorna Mess | 626001 |
| spice@demo.savoresq | Hotel - Spice Garden | 626001 |
| hope@demo.savoresq | NGO - Hope Foundation | 626001 |
| seva@demo.savoresq | NGO - Seva Trust | 626001 |
| marina@demo.savoresq | Hotel - Marina Meals | 600001 (Chennai) |
| chennaicares@demo.savoresq | NGO - Chennai Cares | 600001 |
| madurai@demo.savoresq | NGO - Madurai Seva | 625001 (Madurai) |

## Test cases
| # | Do this | Expected result |
|---|---|---|
| 1 | Login as **hope** (NGO, 626001) | Rescue Radar shows 3 foods: Pasta, Veg Biryani, Idli. **Dosa (Chennai) is NOT shown.** Smart Route lists the pickups in best order. |
| 2 | Login as **chennaicares** (NGO, 600001) | Only **Dosa** from Marina Meals. None of the Sivakasi food. |
| 3 | Login as **madurai** (NGO, 625001) | "No matching donations right now" - no hotel posted in 625001. |
| 4 | Login as **green** (hotel, 626001) -> "NGOs Near You" | Radar shows **Hope Foundation and Seva Trust only**. Chennai Cares and Madurai Seva are NOT shown. |
| 5 | Login as **marina** (hotel, 600001) -> "NGOs Near You" | Only **Chennai Cares**. |
| 6 | As **green**, post food with pincode **600001** | Rejected: "The donation pincode must match your registered pincode." |
| 7 | As **green**, post "Cake" with pincode **626001** | Saved. Log in as **hope**: Cake appears on the radar. **chennaicares** does not get it. |
| 8 | As **hope**, click "Accept all ... and start route" | Foods move to My Rescues with pickup codes. Log in as **seva**: those foods are gone (only one NGO can accept). |
| 9 | As **green**, enter hope's pickup code in the handover box | "Handover verified". A wrong code shows "That code does not match". |
| 10 | Register a new NGO with pincode **626001** | Login says "Approval Pending". Admin -> Users -> **Pending** filter shows it. After Approve, green's "NGOs Near You" includes it. |
| 11 | Logout, then press the browser Back arrow | Goes to the login page, never the dashboard. |
| 12 | Disconnect the internet and reload the NGO page | Radar, route and food pictures all still work (fully offline). |

Note: with no internet the pin positions are estimated from the pincode, so distances are approximate (the page says "approximate").

## Showing exact distances: 200 m, 300 m, 400 m
The pincode only decides **who can see whom**. It cannot set a distance. Distance comes from each account's saved location, and `npm run seed` sets exact locations for the Sivakasi demo (all pincode **626001**). Log in as **hope** (NGO) and the radar shows:

| Hotel (pincode 626001) | Distance from Hope Foundation | Direction |
|---|---|---|
| Green Leaf Hotel | **200 m** | North |
| Annapoorna Mess | **300 m** | East |
| Spice Garden | **400 m** | South |
| Seva Trust (the other NGO, seen from a hotel's radar) | 350 m from Hope | West |

To show your own distance: register or use any accounts with the SAME pincode, then press "Use my current location" on the radar to save the real GPS position (needs a browser/device with GPS). Accounts without a saved location use an estimated position from the pincode, 0.4 - 2 km apart, and the page says "approximate".
