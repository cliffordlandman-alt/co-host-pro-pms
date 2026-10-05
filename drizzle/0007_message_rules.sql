ALTER TABLE templates ADD COLUMN property_id integer REFERENCES properties(id);
--> statement-breakpoint
ALTER TABLE templates ADD COLUMN trigger text NOT NULL DEFAULT 'booking_created';
--> statement-breakpoint
ALTER TABLE templates ADD COLUMN offset_hours integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE properties ADD COLUMN message_variables json;
--> statement-breakpoint
UPDATE templates SET enabled=false;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Booking Confirmation','booking','booking_created',0,'Hi {{guest_name}}, your stay at {{property_name}} is confirmed for {{check_in_date}} to {{check_out_date}}. We look forward to welcoming you. — {{host_name}}','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Booking Confirmation' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='booking_created',offset_hours=0 WHERE name='Booking Confirmation' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'ID / Passport Request','booking','id_missing',0,'Hi {{guest_name}}, please contact {{host_name}} for our secure ID collection process before arrival at {{property_name}}.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='ID / Passport Request' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='id_missing',offset_hours=0 WHERE name='ID / Passport Request' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Check-In Instructions','check_in','before_checkin',24,'Hi {{guest_name}}, check-in at {{property_name}} is on {{check_in_date}} from {{check_in_time}}. {{check_in_instructions}}','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Check-In Instructions' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='before_checkin',offset_hours=24 WHERE name='Check-In Instructions' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Check-In Time Reminder','check_in','before_checkin',3,'Hi {{guest_name}}, check-in begins at {{check_in_time}} today. Please let {{host_name}} know your expected arrival time.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Check-In Time Reminder' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='before_checkin',offset_hours=3 WHERE name='Check-In Time Reminder' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Access Instructions','check_in','before_checkin',2,'Hi {{guest_name}}, your unit is {{unit_number}}. {{access_instructions}} Door code: {{door_code}}. Parking: {{parking}}.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Access Instructions' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='before_checkin',offset_hours=2 WHERE name='Access Instructions' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Wi-Fi Information','check_in','after_checkin',0,'Welcome {{guest_name}}. Wi-Fi: {{wifi_name}}. Password: {{wifi_password}}.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Wi-Fi Information' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='after_checkin',offset_hours=0 WHERE name='Wi-Fi Information' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'House Rules','check_in','before_checkin',24,'Hi {{guest_name}}, please review the house rules for {{property_name}}: {{house_rules}}','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='House Rules' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='before_checkin',offset_hours=24 WHERE name='House Rules' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Welcome Message','check_in','after_checkin',1,'Welcome to {{property_name}}, {{guest_name}}. Please let {{host_name}} know if you need help settling in.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Welcome Message' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='after_checkin',offset_hours=1 WHERE name='Welcome Message' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Mid-Stay Check-In','general','mid_stay',0,'Hi {{guest_name}}, how is your stay at {{property_name}} going? Please let us know if anything needs attention.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Mid-Stay Check-In' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='mid_stay',offset_hours=0 WHERE name='Mid-Stay Check-In' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Check-Out Reminder','check_out','before_checkout',24,'Hi {{guest_name}}, checkout is {{check_out_date}} by {{check_out_time}}. Please let us know if you need assistance.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Check-Out Reminder' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='before_checkout',offset_hours=24 WHERE name='Check-Out Reminder' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Checkout Instructions','check_out','before_checkout',12,'Hi {{guest_name}}, please check out by {{check_out_time}} on {{check_out_date}}. {{check_out_instructions}} Thank you for staying with us.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Checkout Instructions' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='before_checkout',offset_hours=12 WHERE name='Checkout Instructions' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Extension Offer','upsell','before_checkout',48,'Hi {{guest_name}}, would you like to extend your stay? Contact {{host_name}} to check availability and the current price. An extension is subject to confirmation.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Extension Offer' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='before_checkout',offset_hours=48 WHERE name='Extension Offer' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Review Request','review','after_checkout',24,'Hi {{guest_name}}, thank you for staying at {{property_name}}. We would appreciate your honest review of your stay.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Review Request' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='after_checkout',offset_hours=24 WHERE name='Review Request' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Cleaning Notification','general','cleaning_incomplete',0,'Cleaning needs attention at {{property_name}}, unit {{unit_number}}, following checkout on {{check_out_date}}. Please review the assigned cleaning task.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Cleaning Notification' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='cleaning_incomplete',offset_hours=0 WHERE name='Cleaning Notification' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Maintenance Follow-Up','incident','maintenance_open',0,'Please review the open maintenance issue for {{property_name}}, unit {{unit_number}}, and update its status.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Maintenance Follow-Up' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='maintenance_open',offset_hours=0 WHERE name='Maintenance Follow-Up' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Payment Reminder','payment','payment_overdue',0,'Hi {{guest_name}}, the recorded outstanding balance for {{property_name}} is {{amount_due}}. Payment details: {{payment_link}}. Contact {{host_name}} with any questions.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Payment Reminder' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='payment_overdue',offset_hours=0 WHERE name='Payment Reminder' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Security Deposit Reminder','payment','before_checkin',48,'Hi {{guest_name}}, please contact {{host_name}} to confirm the security deposit arrangements for your stay.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Security Deposit Reminder' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='before_checkin',offset_hours=48 WHERE name='Security Deposit Reminder' AND property_id IS NULL;

--> statement-breakpoint
INSERT INTO templates(name,category,trigger,offset_hours,body,channel,enabled) SELECT 'Security Deposit Return','payment','after_checkout',24,'Hi {{guest_name}}, please contact {{host_name}} for the status of your security deposit review and return.','manual',false WHERE NOT EXISTS(SELECT 1 FROM templates WHERE name='Security Deposit Return' AND property_id IS NULL);
--> statement-breakpoint
UPDATE templates SET trigger='after_checkout',offset_hours=24 WHERE name='Security Deposit Return' AND property_id IS NULL;
