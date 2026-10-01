OHMWORKS static site for Cloudflare Pages

To deploy on Cloudflare Pages:

1. Create a new Pages project in Cloudflare and connect to your repository.
2. Set the build command to `""` and the output directory to `"/"` since this is a static site with Pages Functions in /api
3. Add environment variables in the Pages project settings if you want email sending:
   - MAILGUN_API_KEY
   - MAILGUN_DOMAIN

Files:
- index.html - main site
- styles.css - site styles
- images/logo.jpg - logo file
- api/contact.js - Cloudflare Pages Function to forward contact form to Mailgun

Contact: glen@ogmworks.com.au
