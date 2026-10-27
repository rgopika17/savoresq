SavoResQ - Surplus Food Rescue & Distribution System
Stack: Node.js + Express + EJS + MongoDB (Mongoose)

ROLES
  Hotel  - posts surplus food, tracks donations, reads NGO reviews, impact badges
  NGO    - sees food in its own pincode, accepts, marks rescued, leaves feedback
  Admin  - dashboard statistics, verifies hotels/NGOs, manages users,
           reviews profile-update and account-deletion requests, monitors feedback

SETUP (one time)
  1. Install MongoDB Community Server (+ MongoDB Compass, optional viewer).
  2. In this folder:   cp .env.example .env     (Windows: copy .env.example .env)
                       npm install
                       npm start
  3. Open http://localhost:3000

DEFAULT ADMIN (created automatically on first start - change it in .env)
  Email:    admin@savorresq.com
  Password: Admin@12345

TYPICAL DEMO FLOW
  Register a Hotel and an NGO with the SAME 6-digit pincode -> login as Admin and
  approve both (Verifications) -> Hotel posts a donation -> NGO accepts it ->
  NGO marks it rescued -> NGO leaves feedback -> Hotel sees the review.

PROJECT LAYOUT
  app.js              routes + business logic
  models/             User, Donation, Feedback, Notification, ProfileUpdate
  views/partials/     shared sidebar/top bar (shell-start, shell-end) + admin modals
  views/*.ejs         one file per page
  public/css/app.css  shared design system for all logged-in pages
  utils/foodImage.js  food picture: hotel's uploaded photo > stock photo > emoji tile
  uploads/donations/  photos uploaded by hotels (created automatically)

SMART FEATURES (offline, no API key - see utils/ai.js)
- Smart Match score for NGOs (distance, time left, usual portion size, pickup record)
- Food-safety timer: suggests safe-until time by food type, warns about unsafe times
- Surplus forecast: learns which weekday/time a hotel usually has surplus
- Impact analytics: kg of food, CO2 avoided (estimates) and pincode Area Insights for admin
- Offline map (no internet needed), Release food, public certificate verification (/verify/SRQ-XXXXXXXX), Community Heroes

FOOD PHOTOS
Real photos for biryani, dosa, idli, pizza, burger, pasta, samosa, curry, cake, ice cream and cookies are bundled in public/image/foods
(from the open Foodish dataset - credits: github.com/surhud004/Foodish; original image owners remain with their creators).
Other foods show a drawn illustration until the hotel uploads its own photo. To add a photo for a food, drop a jpg into that folder and add P("name") to its line in utils/foodImage.js.

MISTAKES & SUPPORT
- Accepted by mistake: "Undo" works free for 5 minutes (hotel not told, no penalty). After that, "Release" needs a reason and the hotel is told.
- Help & Support: hotels/NGOs send private messages (or "Report issue" on a donation) to the admin; admin replies in Support Requests; notifications both ways.

TALKING TO EACH OTHER
- Hotel <-> NGO: Messages (one private chat per donation, quick replies). Food complaints go here first.
- Hotel/NGO -> Admin: Contact Admin (fraud, unresolved complaints, app problems). "Report to admin" links on chats and donation cards pre-fill the form.
- Accepted by mistake: Undo within 5 min (free). Later: Release with a reason.
- Pickup code: NGO shows a 4-digit code, the hotel verifies it before handing over the food.
- Map: "Use my current location" gives exact GPS; approximate pins are marked and directions use the address.
