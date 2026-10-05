export const VARIABLES=['guest_name','property_name','check_in_date','check_in_time','check_out_date','check_out_time','wifi_name','wifi_password','parking','unit_number','door_code','host_name','amount_due','payment_link','check_in_instructions','check_out_instructions','house_rules','access_instructions'];
export const TRIGGERS=['booking_created','before_checkin','after_checkin','mid_stay','before_checkout','after_checkout','payment_overdue','id_missing','cleaning_incomplete','maintenance_open'];
export const DEFAULT_MESSAGE_TEMPLATES=[
 ['Booking Confirmation','booking','booking_created',0,'Hi {{guest_name}}, your stay at {{property_name}} is confirmed for {{check_in_date}} to {{check_out_date}}. We look forward to welcoming you. — {{host_name}}'],
 ['ID / Passport Request','booking','id_missing',0,'Hi {{guest_name}}, please contact {{host_name}} for our secure ID collection process before arrival at {{property_name}}.'],
 ['Check-In Instructions','check_in','before_checkin',24,'Hi {{guest_name}}, check-in at {{property_name}} is on {{check_in_date}} from {{check_in_time}}. {{check_in_instructions}}'],
 ['Check-In Time Reminder','check_in','before_checkin',3,'Hi {{guest_name}}, check-in begins at {{check_in_time}} today. Please let {{host_name}} know your expected arrival time.'],
 ['Access Instructions','check_in','before_checkin',2,'Hi {{guest_name}}, your unit is {{unit_number}}. {{access_instructions}} Door code: {{door_code}}. Parking: {{parking}}.'],
 ['Wi-Fi Information','check_in','after_checkin',0,'Welcome {{guest_name}}. Wi-Fi: {{wifi_name}}. Password: {{wifi_password}}.'],
 ['House Rules','check_in','before_checkin',24,'Hi {{guest_name}}, please review the house rules for {{property_name}}: {{house_rules}}'],
 ['Welcome Message','check_in','after_checkin',1,'Welcome to {{property_name}}, {{guest_name}}. Please let {{host_name}} know if you need help settling in.'],
 ['Mid-Stay Check-In','general','mid_stay',0,'Hi {{guest_name}}, how is your stay at {{property_name}} going? Please let us know if anything needs attention.'],
 ['Check-Out Reminder','check_out','before_checkout',24,'Hi {{guest_name}}, checkout is {{check_out_date}} by {{check_out_time}}. Please let us know if you need assistance.'],
 ['Checkout Instructions','check_out','before_checkout',12,'Hi {{guest_name}}, please check out by {{check_out_time}} on {{check_out_date}}. {{check_out_instructions}} Thank you for staying with us.'],
 ['Extension Offer','upsell','before_checkout',48,'Hi {{guest_name}}, would you like to extend your stay? Contact {{host_name}} to check availability and the current price. An extension is subject to confirmation.'],
 ['Review Request','review','after_checkout',24,'Hi {{guest_name}}, thank you for staying at {{property_name}}. We would appreciate your honest review of your stay.'],
 ['Cleaning Notification','general','cleaning_incomplete',0,'Cleaning needs attention at {{property_name}}, unit {{unit_number}}, following checkout on {{check_out_date}}. Please review the assigned cleaning task.'],
 ['Maintenance Follow-Up','incident','maintenance_open',0,'Please review the open maintenance issue for {{property_name}}, unit {{unit_number}}, and update its status.'],
 ['Payment Reminder','payment','payment_overdue',0,'Hi {{guest_name}}, the recorded outstanding balance for {{property_name}} is {{amount_due}}. Payment details: {{payment_link}}. Contact {{host_name}} with any questions.'],
 ['Security Deposit Reminder','payment','before_checkin',48,'Hi {{guest_name}}, please contact {{host_name}} to confirm the security deposit arrangements for your stay.'],
 ['Security Deposit Return','payment','after_checkout',24,'Hi {{guest_name}}, please contact {{host_name}} for the status of your security deposit review and return.']
].map(([name,category,trigger,offsetHours,body])=>({name,category,trigger,offsetHours,body,channel:'manual',enabled:false}));
export function renderGuestMessage(body,values){const missing=new Set();const text=String(body).replace(/\{\{\s*([a-z_]+)\s*\}\}|\{([a-z_]+)\}/g,(all,a,b)=>{const key=a||b;const value=values[key];if(value==null||String(value).trim()===''){missing.add(key);return all;}return String(value);});return {body:text,missing:[...missing]};}
export function scheduledMessage(template,booking,property={},now=new Date(),context={}){
 if(!template.enabled||['cancelled','blocked'].includes(booking.status))return null;
 const vars=property.messageVariables||{};
 const values={...vars,guest_name:booking.guestName,property_name:property.name,unit_number:property.unitNumber,check_in_date:booking.checkIn,check_out_date:booking.checkOut,check_in_instructions:property.checkInInstructions||vars.check_in_instructions,house_rules:property.houseRules||vars.house_rules,access_instructions:property.accessDetails||vars.access_instructions,amount_due:booking.paymentStatus==='unknown'?null:`${property.currency||'AED'} ${Number(booking.balanceDue||0).toFixed(2)}`};
 values.lock_code=values.door_code;values.checkout_time=values.check_out_time;values.balance_due=values.amount_due;
 const offset=Number(template.offsetHours||0)*3600000;
 // Scheduling needs explicit local times; no access code or Wi-Fi detail is invented.
 const zone=vars.utc_offset;const checkin=zone&&vars.check_in_time?Date.parse(`${booking.checkIn}T${vars.check_in_time}:00${zone}`):NaN;
 const checkout=zone&&vars.check_out_time?Date.parse(`${booking.checkOut}T${vars.check_out_time}:00${zone}`):NaN;
 let due;
 switch(template.trigger){case 'booking_created':due=new Date(booking.createdAt).getTime();break;case 'before_checkin':due=checkin-offset;break;case 'after_checkin':due=checkin+offset;break;case 'mid_stay':due=checkin+(checkout-checkin)/2;break;case 'before_checkout':due=checkout-offset;break;case 'after_checkout':due=checkout+offset;break;
 case 'payment_overdue':if(!(Number(booking.balanceDue)>0)||booking.paymentStatus==='unknown')return null;due=checkin;break;
 case 'id_missing':if(context.idComplete||booking.checkOut<now.toISOString().slice(0,10))return null;due=checkin-offset;break;
 case 'cleaning_incomplete':if(!context.cleaningIncomplete)return null;due=checkout;break;
 case 'maintenance_open':if(!context.maintenanceOpen)return null;due=now.getTime();break;
 default:return null;}
 const rendered=renderGuestMessage(template.body,values);
 if(!Number.isFinite(due))rendered.missing.push('property scheduling time / UTC offset');
 return {key:`${template.id}:${booking.id}`,templateId:template.id,reservationId:booking.id,guestName:booking.guestName,propertyName:property.name,name:template.name,channel:template.channel,scheduledAt:Number.isFinite(due)?new Date(due).toISOString():null,state:rendered.missing.length?'needs_information':due>now.getTime()?'scheduled':(['after_checkin','mid_stay'].includes(template.trigger)&&!['checked_in','checked_out'].includes(booking.status))||(template.trigger==='after_checkout'&&booking.status!=='checked_out')?'waiting_for_status':'ready_for_review',...rendered};
}
