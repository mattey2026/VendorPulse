@IsTest
private class OMP_RenewalHygieneSchedulerTest {

    private static OMP_Renewal__c makeRenewal(String oem, Date endDate, String status) {
        OMP_Renewal__c r = new OMP_Renewal__c();
        r.OEM__c            = oem;
        r.Vendor_Name__c    = oem + ' Vendor';
        r.Description__c    = oem + ' License';
        r.PO_Number__c      = '1401240001';
        r.Category__c       = 'License';
        r.Currency__c       = 'USD';
        r.PO_Amount__c      = 50000;
        r.ACV_USD__c        = 50000;
        r.Duration_Years__c = 1;
        r.Start_Date__c     = endDate.addYears(-1);
        r.End_Date__c       = endDate;
        r.Hygiene_Status__c = status;
        r.Due_Year__c       = endDate.year();
        insert r;
        return r;
    }

    private static OMP_Renewal__c makeRenewalWithBuyer(String oem, Date endDate, String status, Id buyerId) {
        OMP_Renewal__c r = new OMP_Renewal__c();
        r.OEM__c            = oem;
        r.Vendor_Name__c    = oem + ' Vendor';
        r.Description__c    = oem + ' License';
        r.PO_Number__c      = '1401240002';
        r.Category__c       = 'License';
        r.Currency__c       = 'USD';
        r.PO_Amount__c      = 50000;
        r.ACV_USD__c        = 50000;
        r.Duration_Years__c = 1;
        r.Start_Date__c     = endDate.addYears(-1);
        r.End_Date__c       = endDate;
        r.Hygiene_Status__c = status;
        r.Due_Year__c       = endDate.year();
        r.Sourcing_Buyer__c = buyerId;
        insert r;
        return r;
    }

    private static User createBuyer() {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'System Administrator' LIMIT 1];
        User u = new User();
        u.FirstName         = 'Test';
        u.LastName          = 'Buyer';
        u.Email             = 'testbuyer@vendorpulse.test';
        u.Username          = 'testbuyer' + System.currentTimeMillis() + '@vendorpulse.test';
        u.Alias             = 'tbuyer';
        u.TimeZoneSidKey    = 'Asia/Kolkata';
        u.LocaleSidKey      = 'en_IN';
        u.EmailEncodingKey  = 'UTF-8';
        u.LanguageLocaleKey = 'en_US';
        u.ProfileId         = p.Id;
        insert u;
        return u;
    }

    @IsTest
    static void testSchedulerExecutes() {
        makeRenewal('TestOEM', Date.today().addDays(75), 'Identified');
        Test.startTest();
        String jobId = System.schedule('VendorPulse Test', '0 0 7 * * ?', new OMP_RenewalHygieneScheduler());
        Test.stopTest();
        System.assertNotEquals(null, jobId, 'Job should be registered');
    }

    @IsTest
    static void testNinetyDayAlert() {
        User buyer = createBuyer();
        makeRenewalWithBuyer('NitroOEM', Date.today().addDays(75), 'Identified', buyer.Id);
        Test.startTest();
        OMP_RenewalHygieneScheduler.runAlerts();
        Test.stopTest();
        OMP_Renewal__c r = [SELECT Alert_Sent_90__c FROM OMP_Renewal__c WHERE OEM__c = 'NitroOEM'];
        System.assertEquals(true, r.Alert_Sent_90__c, '90-day alert sent');
    }

    @IsTest
    static void testSixtyDayAlert() {
        User buyer = createBuyer();
        makeRenewalWithBuyer('SAP_OEM', Date.today().addDays(45), 'Engaged', buyer.Id);
        Test.startTest();
        OMP_RenewalHygieneScheduler.runAlerts();
        Test.stopTest();
        OMP_Renewal__c r = [SELECT Alert_Sent_60__c FROM OMP_Renewal__c WHERE OEM__c = 'SAP_OEM'];
        System.assertEquals(true, r.Alert_Sent_60__c, '60-day alert sent');
    }

    @IsTest
    static void testThirtyDayAlert() {
        User buyer = createBuyer();
        makeRenewalWithBuyer('Cisco_OEM', Date.today().addDays(20), 'Approval', buyer.Id);
        Test.startTest();
        OMP_RenewalHygieneScheduler.runAlerts();
        Test.stopTest();
        OMP_Renewal__c r = [SELECT Alert_Sent_30__c FROM OMP_Renewal__c WHERE OEM__c = 'Cisco_OEM'];
        System.assertEquals(true, r.Alert_Sent_30__c, '30-day alert sent');
    }

    @IsTest
    static void testOverdueAlert() {
        User buyer = createBuyer();
        makeRenewalWithBuyer('Overdue_OEM', Date.today().addDays(-10), 'Identified', buyer.Id);
        Test.startTest();
        OMP_RenewalHygieneScheduler.runAlerts();
        Test.stopTest();
        OMP_Renewal__c r = [SELECT Alert_Sent_90__c FROM OMP_Renewal__c WHERE OEM__c = 'Overdue_OEM'];
        System.assertEquals(false, r.Alert_Sent_90__c, 'Overdue should not set 90-day flag');
    }

    @IsTest
    static void testNoDuplicateAlert() {
        User buyer = createBuyer();
        OMP_Renewal__c r = makeRenewalWithBuyer('DedupOEM', Date.today().addDays(75), 'Identified', buyer.Id);
        r.Alert_Sent_90__c = true;
        update r;
        Test.startTest();
        OMP_RenewalHygieneScheduler.runAlerts();
        Test.stopTest();
        OMP_Renewal__c updated = [SELECT Alert_Sent_90__c FROM OMP_Renewal__c WHERE OEM__c = 'DedupOEM'];
        System.assertEquals(true, updated.Alert_Sent_90__c, 'Should remain true');
    }

    @IsTest
    static void testNoAlert_FarFuture() {
        User buyer = createBuyer();
        makeRenewalWithBuyer('FutureOEM', Date.today().addDays(200), 'Identified', buyer.Id);
        Test.startTest();
        OMP_RenewalHygieneScheduler.runAlerts();
        Test.stopTest();
        OMP_Renewal__c r = [SELECT Alert_Sent_90__c FROM OMP_Renewal__c WHERE OEM__c = 'FutureOEM'];
        System.assertEquals(false, r.Alert_Sent_90__c, 'No alert for 200+ days');
    }

    @IsTest
    static void testNoAlert_ClosedRecord() {
        makeRenewal('ClosedOEM', Date.today().addDays(-5), 'Closed');
        Test.startTest();
        OMP_RenewalHygieneScheduler.runAlerts();
        Test.stopTest();
        System.assert(true, 'Should complete without error');
    }

    @IsTest
    static void testNoAlert_NoBuyer() {
        makeRenewal('NoBuyerOEM', Date.today().addDays(20), 'Identified');
        Test.startTest();
        OMP_RenewalHygieneScheduler.runAlerts();
        Test.stopTest();
        System.assert(true, 'Should handle missing buyer');
    }
}
