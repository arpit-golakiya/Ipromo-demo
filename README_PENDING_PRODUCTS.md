## Pending products (expired GLB URLs / HTTP 403)

These product variants returned **HTTP 403** during bulk GLB download from the URLs stored in Supabase/CSV.
In practice this usually means the stored `glb_url` is an **expired signed URL** (common with Hyper3D `file.hyper3d.com` links).

### Why this happens
- Many GLB links are **pre-signed URLs** that include an expiry (for example `X-Tos-Expires=604800`).
- Once expired, loads fail and can cause client-side errors when a model is selected.

### What we did / recommended fix
- Download all non-expired models locally (where possible).
- Upload local `.glb` files to a **private S3 bucket** using a stable key structure:
  - `product_key/color_label/<id>-<group>.glb`
- Store the S3 reference in Supabase (recommended: store `s3://bucket/key` in `glb_url`).
- App loads `glb_url`:
  - If it starts with `s3://`, the server generates a **fresh signed S3 URL** per request and returns the GLB.

### Pending list (needs regeneration / re-upload)

#### Aluminum Sports Bottle
- Black (BLK)
- Blue (BL)
- Green (GR)
- Light Blue (LBL)
- Orange (OR)
- Purple (PP)
- Red (RD)
- Silver (SI)
- White (WH)

#### Copper Vacuum Stainless Steel Bottle
- Group 1
- Group 7
- Mint Green
- Navy
- RED
- SILVER
- WHITE

#### Cotton Twill Foldable Bucket Hat
- BEIGE
- Black (BK)
- Brown (BR)
- Gray (GY)
- Light Blue (LBL)
- Navy (NY)
- Olive (OL)
- Orange (OR)
- Pink (PK)
- Red (RD)
- Royal (RYL)
- White (WH)

#### Nike Dri-FIT Classic Polo Shirt
- COURT BLUE
- LIGHT BLUE
- Midnight Navy
- Varsity Red
- WHITE

#### Sip Insulated Stainless Steel Water Bottle
- DARK BLUE
- PINK
- Pink
- Purple
- Red
- Teal
- TEAL
- White
- White/white
- white_white

#### stanleyr quencher h2 o flowstatetm tumbler
- Ash
- Azure
- Cream
- FROST
- Hot Coral
- Rose Quartz
- Seafoam
- Stone (ST)

#### the north face glacier full zip fleece jacket men
- Asphalt Grey/ TNF Black
- Hero Blue/TNF Black
- Rage Red/TNF Black
- TNF Black
- TNF Medium Grey Heather

#### yeti ramblerr tumbler
- BLACK
- Charcoal (CA)
- Navy
- Seafoam
- Silver (SI)
- White (WH)

#### yeti ramblerr tumbler 20 oz
- BLACK
- Canopy Green
- Charcoal (CA)
- High Desert Clay
- Navy
- Red
- Royal
- Seafoam
- SILVER
- WHITE

# PROMPT

You are working in my 3D model creation codebase. Implement the SAME pipeline and conventions we used in my other repo:
## Goal
Generate and store preloaded 3D GLB models per product color, then make them load reliably (no expiring URLs in DB).
## Requirements
- Input: product page URL(s) and their variant images (color-wise).
- Group images by color/variant. Each variant should map to one model id/row.
- Optional toggle: “Clean photo first (remove people & on-product branding)” using OpenAI (Responses API + image_generation) BEFORE 3D generation.
- Generate 3D models using Hyper3D/Rodin (or our configured provider) and obtain a GLB file.
- Download the GLB locally after generation succeeds.
- Upload the GLB to a PRIVATE S3 bucket using this exact key structure:
  <product_key>/<color_label>/<id>-<group>.glb
  (normalize product_key and color_label to URL-safe slugs but keep them readable)
- Store into Supabase:
  - table: preloaded_models (configurable)
  - id column: id
  - store: s3://<bucket>/<key> into glb_url (recommended, avoids expiry)
- App-side loading assumption:
  - When glb_url starts with s3://, server signs a short-lived GET URL and streams/returns GLB.
  - Otherwise fall back to old http glb_url.
## Non-functional
- Concurrency for batch generation + uploading.
- Retry on transient provider errors (429/502/503/timeouts).
- Never crash the batch because one color fails; collect per-variant status.
- Output a manifest file (CSV/JSON) recording: id, product_key, color_label, s3_key, s3_uri, status, error.
## Deliverables
- Scripts/commands to run the full pipeline end-to-end
- Clear env vars to configure:
  OPENAI_API_KEY, HYPER3D_API_KEY,
  AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_TABLE
- Do not store any secrets in git or logs.