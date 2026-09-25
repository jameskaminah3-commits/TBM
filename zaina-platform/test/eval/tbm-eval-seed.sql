-- Evaluation seed, run after test/e2e/tbm-seed.sql: its listings plus a chef, an experience, MamaCare
-- and a Watamu villa, so every TBM service can be asked about. Local test
-- databases only (the runner refuses anything else).

DELETE FROM cooks WHERE id = 'cook-amani';
DELETE FROM experiences WHERE id = 'exp-dhow';
DELETE FROM errands WHERE id = 'errand-mamacare';
DELETE FROM stays WHERE id = 'stay-watamu-villa';

INSERT INTO stays (id, title, location, description, price, max_occupancy, bedrooms, bathrooms, features, is_public, manager_user_id, created_at, updated_at)
VALUES ('stay-watamu-villa', '4 Bedroom Beach Villa – Watamu', 'Watamu Beach, Watamu', 'Beachfront villa with a pool, 10 minutes from the marine park.', 250, 8, 4, 4, '{Pool,Beachfront,WiFi}', true, 'provider-1', now()::text, now()::text);

INSERT INTO cooks (id, title, location, speciality, max_guests, minimum_guests, price_per_session, price_per_plate, price_single_meal, min_plates, description, features, is_public, manager_user_id, created_at, updated_at)
VALUES ('cook-amani', 'Chef Amani – Swahili Coast Cuisine', 'Nyali', 'Swahili seafood', 12, 2, 80, 15, 60, 4, 'Swahili seafood dinners cooked at your villa.', '{}', true, 'provider-1', now()::text, now()::text);

INSERT INTO experiences (id, title, location, experience_type, price, duration_hours, min_guests, max_guests, private_enabled, private_price_per_person, private_minimum_guests, shared_enabled, description, features, is_public, manager_user_id, created_at, updated_at)
VALUES ('exp-dhow', 'Sunset Dhow Cruise – Mombasa', 'Mombasa', 'boat', 40, 3, 2, 12, true, 45, 2, false, 'A traditional dhow cruise around Mombasa at sunset.', '{}', true, 'provider-1', now()::text, now()::text);

INSERT INTO errands (id, service_name, location, base_price, help_mama_pricing, description, features, is_public, manager_user_id, created_at, updated_at)
VALUES ('errand-mamacare', 'MamaCare Childcare', 'Mombasa', 10,
  '{"enabled":true,"hourlyDaytimePrice":0,"hourlyEveningPrice":0,"overnightPrice":0,"fullDayPrice":0,"ageBands":[{"id":"help-mama-toddler","label":"Toddler (1-3 years)","price":0,"hourlyDaytimePrice":6,"hourlyEveningPrice":8,"overnightPrice":50,"fullDayPrice":45},{"id":"help-mama-child","label":"Child (4-12 years)","price":0,"hourlyDaytimePrice":5,"hourlyEveningPrice":7,"overnightPrice":45,"fullDayPrice":40}]}'::jsonb,
  'Vetted caregivers who look after children at your accommodation.', '{}', true, 'provider-1', now()::text, now()::text);
