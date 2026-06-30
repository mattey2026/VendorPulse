@IsTest
private class OMP_RenewalControllerTest {

    private static OMP_Renewal__c makeRecord(String oem, Date endDate, String status, Decimal acv) {
        OMP_Renewal__c r = new OMP_Renewal__c();
        r.OEM__c               = oem;
        r.Vendor_Name__c       = oem + ' Vendor';
        r.Description__c       = oem + ' License';
        r.PO_Number__c         = '1401240001';
        r.Category__c          = 'License';
        r.Currency__c          = 'USD';
        r.PO_Amount__c         = acv;
        r.ACV_USD__c           = acv;
        r.Last_Year_ACV_USD__c = acv - 10000;
        r.Duration_Years__c    = 1;
        r.Start_Date__c        = endDate.addYears(-1);
        r.End_Date__c          = endDate;
        r.Hygiene_Status__c    = status;
        r.Due_Year__c          = endDate.year();
        return r;
    }

    @IsTest
    static void testGetRenewals_NoFilter() {
        Date future = Date.today().addDays(60);
        OMP_Renewal__c r1 = makeRecord('OEM_A', future, 'Identified', 50000);
        OMP_Renewal__c r2 = makeRecord('OEM_B', future, 'Engaged', 60000);
        OMP_Renewal__c r3 = makeRecord('OEM_C', future, 'Closed', 70000);
        insert new List<OMP_Renewal__c>{ r1, r2, r3 };
        Test.startTest();
        List<OMP_RenewalController.RenewalWrapper> results = OMP_RenewalController.getRenewals('', '', '', '');
        Test.stopTest();
        System.assertEquals(2, results.size(), 'Should return 2 active renewals');
    }

    @IsTest
    static void testGetRenewals_CategoryFilter() {
        Date future = Date.today().addDays(60);
        OMP_Renewal__c r1 = makeRecord('OEM_A', future, 'Identified', 50000);
        r1.Category__c = 'License';
        OMP_Renewal__c r2 = makeRecord('OEM_B', future, 'Identified', 60000);
        r2.Category__c = 'AMC';
        insert new List<OMP_Renewal__c>{ r1, r2 };
        Test.startTest();
        List<OMP_RenewalController.RenewalWrapper> results = OMP_RenewalController.getRenewals('License', '', '', '');
        Test.stopTest();
        System.assertEquals(1, results.size(), 'Should return only License');
    }

    @IsTest
    static void testGetRenewals_StatusFilter() {
        Date future = Date.today().addDays(60);
        OMP_Renewal__c r1 = makeRecord('OEM_A', future, 'Engaged', 50000);
        OMP_Renewal__c r2 = makeRecord('OEM_B', future, 'Identified', 60000);
        insert new List<OMP_Renewal__c>{ r1, r2 };
        Test.startTest();
        List<OMP_RenewalController.RenewalWrapper> results = OMP_RenewalController.getRenewals('', 'Engaged', '', '');
        Test.stopTest();
        System.assertEquals(1, results.size(), 'Should return only Engaged');
    }

    @IsTest
    static void testGetRenewals_SearchTerm() {
        Date future = Date.today().addDays(60);
        OMP_Renewal__c r1 = makeRecord('Salesforce', future, 'Identified', 7000000);
        OMP_Renewal__c r2 = makeRecord('Microsoft',  future, 'Identified', 6900000);
        insert new List<OMP_Renewal__c>{ r1, r2 };
        Test.startTest();
        List<OMP_RenewalController.RenewalWrapper> results = OMP_RenewalController.getRenewals('', '', 'Salesforce', '');
        Test.stopTest();
        System.assertEquals(1, results.size(), 'Search should return 1');
    }

    @IsTest
    static void testGetDashboardMetrics() {
        Date future = Date.today().addDays(60);
        OMP_Renewal__c r1 = makeRecord('OEM_A', future, 'Identified', 100000);
        OMP_Renewal__c r2 = makeRecord('OEM_B', future, 'Engaged', 200000);
        insert new List<OMP_Renewal__c>{ r1, r2 };
        Test.startTest();
        OMP_RenewalController.DashboardMetrics m = OMP_RenewalController.getDashboardMetrics();
        Test.stopTest();
        System.assert(m.totalRenewals >= 2, 'Should count active records');
        System.assert(m.totalACV > 0, 'ACV should be positive');
    }

    @IsTest
    static void testGetDashboardMetrics_Empty() {
        Test.startTest();
        OMP_RenewalController.DashboardMetrics m = OMP_RenewalController.getDashboardMetrics();
        Test.stopTest();
        System.assert(m.totalRenewals >= 0, 'Should not throw');
    }

    @IsTest
    static void testGetClosureLog() {
        OMP_Renewal__c r1 = makeRecord('OEM_Closed', Date.today().addDays(-30), 'Closed', 50000);
        OMP_Renewal__c r2 = makeRecord('OEM_Active', Date.today().addDays(60),  'Identified', 70000);
        insert new List<OMP_Renewal__c>{ r1, r2 };
        Test.startTest();
        List<OMP_RenewalController.RenewalWrapper> results = OMP_RenewalController.getClosureLog();
        Test.stopTest();
        System.assertEquals(1, results.size(), 'Should return only Closed');
    }

    @IsTest
    static void testGetClosureLog_Empty() {
        OMP_Renewal__c r = makeRecord('OEM_Active', Date.today().addDays(60), 'Identified', 50000);
        insert r;
        Test.startTest();
        List<OMP_RenewalController.RenewalWrapper> results = OMP_RenewalController.getClosureLog();
        Test.stopTest();
        System.assertEquals(0, results.size(), 'Should be empty');
    }

    @IsTest
    static void testSaveRenewal_Insert() {
        OMP_Renewal__c r = makeRecord('Salesforce', Date.today().addDays(200), 'Identified', 7000000);
        Test.startTest();
        OMP_Renewal__c saved = OMP_RenewalController.saveRenewal(r);
        Test.stopTest();
        System.assertNotEquals(null, saved.Id, 'Should have Id');
    }

    @IsTest
    static void testSaveRenewal_Update() {
        OMP_Renewal__c r = makeRecord('Microsoft', Date.today().addDays(66), 'Identified', 6900000);
        insert r;
        r.ACV_USD__c        = 7200000;
        r.Hygiene_Status__c = 'Engaged';
        Test.startTest();
        OMP_RenewalController.saveRenewal(r);
        Test.stopTest();
        OMP_Renewal__c fetched = [SELECT ACV_USD__c, Hygiene_Status__c FROM OMP_Renewal__c WHERE Id = :r.Id];
        System.assertEquals(7200000, fetched.ACV_USD__c, 'ACV updated');
        System.assertEquals('Engaged', fetched.Hygiene_Status__c, 'Status updated');
    }

    @IsTest
    static void testSaveAndSplit_ThreeYears() {
        OMP_Renewal__c base = new OMP_Renewal__c();
        base.OEM__c                  = 'Oracle';
        base.Vendor_Name__c          = 'Oracle India';
        base.Description__c          = 'Oracle ERP';
        base.PO_Number__c            = '1401241025';
        base.Category__c             = 'License';
        base.Currency__c             = 'USD';
        base.PO_Amount__c            = 15000000;
        base.Estimated_PO_TCV_USD__c = 15000000;
        base.ACV_USD__c              = 5000000;
        base.Duration_Years__c       = 3;
        base.Start_Date__c           = Date.newInstance(2024, 4, 1);
        base.End_Date__c             = Date.newInstance(2027, 3, 31);
        base.Hygiene_Status__c       = 'Engaged';
        List<Decimal> acvs = new List<Decimal>();
        acvs.add(4500000);
        acvs.add(5000000);
        acvs.add(5500000);
        Test.startTest();
        List<Id> ids = OMP_RenewalController.saveAndSplit(base, acvs);
        Test.stopTest();
        System.assertEquals(3, ids.size(), 'Should create 3 records');
        List<OMP_Renewal__c> created = [SELECT ACV_USD__c, Hygiene_Status__c FROM OMP_Renewal__c WHERE Id IN :ids ORDER BY Start_Date__c ASC];
        System.assertEquals(4500000,  created[0].ACV_USD__c, 'Year 1 ACV');
        System.assertEquals('Engaged',    created[0].Hygiene_Status__c, 'Year 1 status');
        System.assertEquals('Identified', created[1].Hygiene_Status__c, 'Year 2 status');
        System.assertEquals('Identified', created[2].Hygiene_Status__c, 'Year 3 status');
    }

    @IsTest
    static void testSaveAndSplit_TwoYears() {
        OMP_Renewal__c base = new OMP_Renewal__c();
        base.OEM__c            = 'SAP';
        base.Vendor_Name__c    = 'SAP India';
        base.Description__c    = 'SAP License';
        base.PO_Number__c      = '1401240099';
        base.Category__c       = 'License';
        base.Currency__c       = 'USD';
        base.PO_Amount__c      = 10000000;
        base.Duration_Years__c = 2;
        base.Start_Date__c     = Date.newInstance(2024, 1, 1);
        base.End_Date__c       = Date.newInstance(2025, 12, 31);
        base.Hygiene_Status__c = 'Identified';
        List<Decimal> acvs = new List<Decimal>();
        acvs.add(5000000);
        acvs.add(5000000);
        Test.startTest();
        List<Id> ids = OMP_RenewalController.saveAndSplit(base, acvs);
        Test.stopTest();
        System.assertEquals(2, ids.size(), '2-year split');
    }

    @IsTest
    static void testCloseAndRollover() {
        OMP_Renewal__c r = makeRecord('Adobe', Date.today().addDays(30), 'PR Created', 22000);
        insert r;
        Test.startTest();
        String nextId = OMP_RenewalController.closeAndRollover(r.Id, Date.today(), 24000);
        Test.stopTest();
        OMP_Renewal__c original = [SELECT Hygiene_Status__c FROM OMP_Renewal__c WHERE Id = :r.Id];
        System.assertEquals('Closed', original.Hygiene_Status__c, 'Should be Closed');
        OMP_Renewal__c next = [SELECT ACV_USD__c, Hygiene_Status__c FROM OMP_Renewal__c WHERE Id = :nextId];
        System.assertEquals(24000, next.ACV_USD__c, 'Next ACV');
        System.assertEquals('Identified', next.Hygiene_Status__c, 'Next status');
    }

    @IsTest
    static void testSendEscalationEmail() {
        Test.startTest();
        OMP_RenewalController.sendEscalationEmail('test@genpact.com', 'Test', 'Test body.');
        Test.stopTest();
        System.assert(true, 'Should complete without error');
    }

    @IsTest
    static void testGetRenewals_Empty() {
        Test.startTest();
        List<OMP_RenewalController.RenewalWrapper> results = OMP_RenewalController.getRenewals('', '', '', '');
        Test.stopTest();
        System.assertNotEquals(null, results, 'Should not be null');
    }
}
