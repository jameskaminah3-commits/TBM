-- 0013_widget_whatsapp.sql
--
-- The website chat for any business (zaina.js):
--
--   business_settings.widget_whatsapp
--                       with a WhatsApp number connected, the website chat
--                       also offers "Chat on WhatsApp" (a wa.me link to the
--                       number). On unless the business turns it off.

alter table business_settings add column widget_whatsapp boolean not null default true;
