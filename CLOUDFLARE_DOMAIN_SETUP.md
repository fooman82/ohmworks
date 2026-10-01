# Cloudflare Pages Custom Domain Setup for www.ohmworks.com.au

## Prerequisites:
- Your domain ohmworks.com.au must be registered
- Your Cloudflare account and Pages project are set up (ohmworks)

## Steps to Connect www.ohmworks.com.au to Cloudflare Pages:

### Option 1: Using Cloudflare Nameservers (Recommended)

1. **In Cloudflare Dashboard:**
   - Go to https://dash.cloudflare.com
   - Select your account
   - Add a new site / domain: ohmworks.com.au
   - Follow the setup wizard (free plan is fine)
   - Cloudflare will give you 2 nameservers (NS records)

2. **Update Your Domain Registrar:**
   - Log into your domain registrar (where you bought ohmworks.com.au)
   - Find "Nameservers" or "DNS Settings"
   - Replace existing nameservers with Cloudflare's nameservers:
     - Usually something like: ns1.cloudflare.com, ns2.cloudflare.com
   - Save and wait 24-48 hours for propagation

3. **Add Custom Domain to Pages Project:**
   - In Cloudflare Dashboard, go to Workers & Pages → Pages
   - Select "ohmworks" project
   - Go to Settings → Custom domains
   - Click "Add custom domain"
   - Enter: www.ohmworks.com.au
   - Click "Continue"
   - Cloudflare will auto-detect the DNS records and create them
   - Verify and confirm

4. **Optional: Add root domain redirect**
   - Also add: ohmworks.com.au (without www)
   - Then set up a redirect rule to forward ohmworks.com.au → www.ohmworks.com.au
   - In Cloudflare Dashboard: Rules → Page Rules (or Bulk Redirects)
   - Create: ohmworks.com.au/* → https://www.ohmworks.com.au/$1 (301 redirect)

---

### Option 2: Using CNAME Records (If you keep existing nameservers)

If your domain registrar doesn't support changing nameservers, or you want to keep existing DNS:

1. **In Cloudflare Pages Settings:**
   - Go to Settings → Custom domains → Add custom domain
   - Enter: www.ohmworks.com.au
   - Cloudflare will tell you the CNAME target (usually something.pages.dev)

2. **At Your Domain Registrar:**
   - Log into your registrar's DNS management
   - Create a CNAME record:
     - Name: www
     - Type: CNAME
     - Value: [Cloudflare will give you this, e.g., ohmworks.pages.dev]
   - Wait 24-48 hours for DNS propagation

3. **Verify:**
   - In Cloudflare Pages, click "Verify domain"
   - Once verified, your site will be live at www.ohmworks.com.au

---

## DNS Propagation Check:
- Use: https://www.whatsmydns.net/
- Enter: www.ohmworks.com.au
- Check if DNS resolves to Cloudflare (propagation status worldwide)

## Testing:
- Once propagated, visit: https://www.ohmworks.com.au
- Should load the OHMWORKS site

---

## Notes:
- SSL/HTTPS is automatically managed by Cloudflare (free)
- DNS changes can take up to 48 hours to fully propagate globally
- You can check status in Cloudflare Dashboard → Custom domains
- After setup, all http://www.ohmworks.com.au traffic will auto-redirect to https://

---

## If You Need Help:
Contact your domain registrar's support for help changing nameservers (they vary by provider)
Common registrars: GoDaddy, NameCheap, Aussie Domains, etc.
