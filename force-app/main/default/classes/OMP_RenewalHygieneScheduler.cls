global class OMP_RenewalHygieneScheduler implements Schedulable {
    global void execute(SchedulableContext sc) {
        runAlerts();
    }

    @future(callout=false)
    public static void runAlerts() {
        List<OMP_Renewal__c> renewals = [
            SELECT Id, Name, OEM__c, Vendor_Name__c, Description__c, PO_Number__c,
                   End_Date__c, Days_To_Renewal__c, Hygiene_Status__c, ACV_USD__c,
                   Category__c, Alert_Sent_90__c, Alert_Sent_60__c, Alert_Sent_30__c,
                   Sourcing_Buyer__c
            FROM OMP_Renewal__c
            WHERE Hygiene_Status__c != 'Closed' AND End_Date__c != null
        ];
        Set<Id> buyerIds = new Set<Id>();
        for (OMP_Renewal__c r : renewals) { if (r.Sourcing_Buyer__c != null) buyerIds.add(r.Sourcing_Buyer__c); }
        Map<Id, User> userMap = new Map<Id, User>();
        Map<Id, User> managerMap = new Map<Id, User>();
        if (!buyerIds.isEmpty()) {
            for (User u : [SELECT Id, Name, Email, ManagerId FROM User WHERE Id IN :buyerIds]) {
                userMap.put(u.Id, u);
                if (u.ManagerId != null) managerMap.put(u.ManagerId, null);
            }
            if (!managerMap.isEmpty()) {
                for (User m : [SELECT Id, Name, Email FROM User WHERE Id IN :managerMap.keySet()]) {
                    managerMap.put(m.Id, m);
                }
            }
        }
        List<OMP_Renewal__c> toUpdate = new List<OMP_Renewal__c>();
        List<Messaging.SingleEmailMessage> emails = new List<Messaging.SingleEmailMessage>();
        for (OMP_Renewal__c r : renewals) {
            Integer days = r.Days_To_Renewal__c != null ? Integer.valueOf(r.Days_To_Renewal__c) : 9999;
            User buyer = r.Sourcing_Buyer__c != null ? userMap.get(r.Sourcing_Buyer__c) : null;
            String buyerEmail = buyer != null ? buyer.Email : null;
            String managerEmail = null;
            if (buyer != null && buyer.ManagerId != null) {
                User mgr = managerMap.get(buyer.ManagerId);
                managerEmail = mgr != null ? mgr.Email : null;
            }
            if (days <= 90 && days > 60 && !r.Alert_Sent_90__c && String.isNotBlank(buyerEmail)) {
                emails.add(buildEmail(buyerEmail, '[VendorPulse] Start renewal - ' + r.OEM__c + ' - ' + days + ' days', buildBody(r, days, '90 DAY ALERT', 'Start vendor engagement now.')));
                toUpdate.add(new OMP_Renewal__c(Id = r.Id, Alert_Sent_90__c = true));
            } else if (days <= 60 && days > 30 && !r.Alert_Sent_60__c && String.isNotBlank(buyerEmail)) {
                emails.add(buildEmail(buyerEmail, '[VendorPulse] URGENT - ' + r.OEM__c + ' - ' + days + ' days', buildBody(r, days, '60 DAY ALERT', 'VGO and legal approvals must start now.')));
                toUpdate.add(new OMP_Renewal__c(Id = r.Id, Alert_Sent_60__c = true));
            } else if (days <= 30 && days > 0 && !r.Alert_Sent_30__c) {
                List<String> toList = new List<String>();
                if (String.isNotBlank(buyerEmail)) toList.add(buyerEmail);
                if (String.isNotBlank(managerEmail)) toList.add(managerEmail);
                if (!toList.isEmpty()) emails.add(buildEmailMulti(toList, '[VendorPulse] CRITICAL - ' + days + ' days - ' + r.OEM__c, buildBody(r, days, 'CRITICAL', 'Raise PR in SAP immediately.')));
                toUpdate.add(new OMP_Renewal__c(Id = r.Id, Alert_Sent_30__c = true));
            } else if (days < 0) {
                List<String> toList = new List<String>();
                if (String.isNotBlank(buyerEmail)) toList.add(buyerEmail);
                if (String.isNotBlank(managerEmail)) toList.add(managerEmail);
                if (!toList.isEmpty()) emails.add(buildEmailMulti(toList, '[VendorPulse] OVERDUE - ' + Math.abs(days) + ' days - ' + r.OEM__c, buildBody(r, days, 'OVERDUE', 'Licence lapsed. Raise PR immediately.')));
            }
        }
        if (!toUpdate.isEmpty()) update toUpdate;
        if (!emails.isEmpty()) Messaging.sendEmail(emails);
    }

    private static Messaging.SingleEmailMessage buildEmail(String toAddr, String sub, String body) {
        return buildEmailMulti(new List<String>{ toAddr }, sub, body);
    }

    private static Messaging.SingleEmailMessage buildEmailMulti(List<String> toList, String sub, String body) {
        Messaging.SingleEmailMessage m = new Messaging.SingleEmailMessage();
        m.setToAddresses(toList);
        m.setSubject(sub);
        m.setPlainTextBody(body);
        m.setSaveAsActivity(false);
        return m;
    }

    private static String buildBody(OMP_Renewal__c r, Integer days, String header, String msg) {
        return '=== ' + header + ' ===\n\nOEM: ' + r.OEM__c + '\nVendor: ' + r.Vendor_Name__c
            + '\nPO: ' + (r.PO_Number__c != null ? r.PO_Number__c : 'N/A')
            + '\nEnd date: ' + (r.End_Date__c != null ? r.End_Date__c.format() : 'N/A')
            + '\nDays: ' + days + '\nACV: $' + (r.ACV_USD__c != null ? r.ACV_USD__c.toPlainString() : '0')
            + '\nStatus: ' + r.Hygiene_Status__c + '\n\n' + msg
            + '\n\n---\nVendorPulse automated alert.';
    }
}
