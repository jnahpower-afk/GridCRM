-- Sub-campaigns within the Data Centres area.
-- 'campaign' stays 'DC' as the umbrella/section marker (keeps all existing
-- dashboards/projects code that filters campaign='DC' working). A new
-- dc_campaign column holds the specific campaign for DC leads:
--   Distro Compute (the former plain 'DC' leads), RtB Acqui, Powered Land.
-- Non-DC leads leave dc_campaign null.

alter table private_wire_leads add column if not exists dc_campaign text;

-- Existing DC leads become "Distro Compute".
update private_wire_leads
  set dc_campaign = 'Distro Compute'
  where campaign = 'DC' and dc_campaign is null;

alter table private_wire_leads drop constraint if exists private_wire_leads_dc_campaign_check;
alter table private_wire_leads add constraint private_wire_leads_dc_campaign_check
  check (dc_campaign is null or dc_campaign in ('Distro Compute', 'RtB Acqui', 'Powered Land'));
