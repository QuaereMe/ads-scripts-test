// Copyright 2017, Google Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @name MCC Account Anomaly Detector
 *
 * @fileoverview The MCC Account Anomaly Detector alerts the advertiser whenever
 * one or more accounts in a group of advertiser accounts under an MCC account
 * is suddenly behaving too differently from what's historically observed. See
 * https://developers.google.com/google-ads/scripts/docs/solutions/adsmanagerapp-account-anomaly-detector
 * for more details.
 *
 * @author Google Ads Scripts Team [adwords-scripts@googlegroups.com]
 *
 * @version 1.4
 *
 * @changelog
 * - version 1.4
 *   - Added conversions to tracked statistics.
 * - version 1.3.2
 *   - Added validation for external spreadsheet setup.
 * - version 1.3.1
 *   - Improvements to time zone handling.
 * - version 1.3
 *   - Cleanup the script a bit for easier debugging and maintenance.
 * - version 1.2
 *   - Added Google Ads API report version.
 * - version 1.1
 *   - Fix the script to work in accounts where there is no stats.
 * - version 1.0
 *   - Released initial version.
 */

var SPREADSHEET_URL = 'YOUR_SPREADSHEET_URL';

var CONFIG = {
  // Uncomment below to include an account label filter
  // ACCOUNT_LABEL: 'High Spend Accounts'
};

var CONST = {
  FIRST_DATA_ROW: 12,
  FIRST_DATA_COLUMN: 2,
  MCC_CHILD_ACCOUNT_LIMIT: 50,
  TOTAL_DATA_COLUMNS: 9
};

var STATS = {
  'NumOfColumns': 4,
  'Impressions':
      {'Column': 3, 'Color': 'red', 'AlertRange': 'impressions_alert'},
  'Clicks': {'Column': 4, 'Color': 'orange', 'AlertRange': 'clicks_alert'},
  'Conversions':
      {'Column': 5, 'Color': 'dark yellow 2', 'AlertRange': 'conversions_alert'},
  'Cost': {'Column': 6, 'Color': 'yellow', 'AlertRange': 'cost_alert'}
};

var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
            'Saturday', 'Sunday'];

/**
 * Configuration to be used for running reports.
 */
var REPORTING_OPTIONS = {
  // Comment out the following line to default to the latest reporting version.
  apiVersion: 'v201809'
};

function main() {
  var account;
  var alertText = [];

  Logger.log('Using spreadsheet - %s.', SPREADSHEET_URL);
  var spreadsheet = validateAndGetSpreadsheet(SPREADSHEET_URL);
  spreadsheet.setSpreadsheetTimeZone(AdsApp.currentAccount().getTimeZone());

  var dataRow = CONST.FIRST_DATA_ROW;

  SheetUtil.setupData(spreadsheet);

  Logger.log('MCC account: ' + mccManager.mccAccount().getCustomerId());
  while (account = mccManager.next()) {
    Logger.log('Processing account ' + account.getCustomerId());
    alertText.push(processAccount(account, spreadsheet, dataRow));
    dataRow++;
  }

  sendEmail(mccManager.mccAccount(), alertText, spreadsheet);
}

/**
 * For each of Impressions, Clicks, Conversions, and Cost, check to see if the
 * values are out of range. If they are, and no alert has been set in the
 * spreadsheet, then 1) Add text to the email, and 2) Add coloring to the cells
 * corresponding to the statistic.
 *
 * @return {string} the next piece of the alert text to include in the email.
 */
function processAccount(account, spreadsheet, startingRow) {
  var sheet = spreadsheet.getSheets()[0];

  var thresholds = SheetUtil.thresholds();
  var today = AdsApp.report(SheetUtil.getTodayQuery(), REPORTING_OPTIONS);
  var past = AdsApp.report(SheetUtil.getPastQuery(), REPORTING_OPTIONS);

  var hours = SheetUtil.hourOfDay();
  var todayStats = accumulateRows(today.rows(), hours, 1); // just one week
  var pastStats = accumulateRows(past.rows(), hours, SheetUtil.weeksToAvg());

  var alertText = ['Account ' + account.getCustomerId()];
  var validWhite = ['', 'white', '#ffffff']; // these all count as white

  // Colors cells that need alerting, and adds text to the alert email body.
  function generateAlert(field, emailAlertText) {
    // There are 2 cells to check, for Today's value and Past value
    var bgRange = [
      sheet.getRange(startingRow, STATS[field].Column, 1, 1),
      sheet.getRange(startingRow, STATS[field].Column + STATS.NumOfColumns,
        1, 1)
    ];
    var bg = [bgRange[0].getBackground(), bgRange[1].getBackground()];

    // If both backgrounds are white, change background Colors
    // and update most recent alert time.
    if ((-1 != validWhite.indexOf(bg[0])) &&
        (-1 != validWhite.indexOf(bg[1]))) {
      bgRange[0].setBackground([[STATS[field]['Color']]]);
      bgRange[1].setBackground([[STATS[field]['Color']]]);

      spreadsheet.getRangeByName(STATS[field]['AlertRange']).
        setValue('Alert at ' + hours + ':00');
      alertText.push(emailAlertText);
    }
  }

  if (thresholds.Impressions &&
      todayStats.Impressions < pastStats.Impressions * thresholds.Impressions) {
    generateAlert('Impressions',
                  '    Impressions are too low: ' + todayStats.Impressions +
                  ' Impressions by ' + hours + ':00, expecting at least ' +
                  parseInt(pastStats.Impressions * thresholds.Impressions));
  }

  if (thresholds.Clicks &&
      todayStats.Clicks < (pastStats.Clicks * thresholds.Clicks).toFixed(1)) {
    generateAlert('Clicks',
                  '    Clicks are too low: ' + todayStats.Clicks +
                  ' Clicks by ' + hours + ':00, expecting at least ' +
                  (pastStats.Clicks * thresholds.Clicks).toFixed(1));
  }

  if (thresholds.Conversions &&
      todayStats.Conversions <
          (pastStats.Conversions * thresholds.Conversions).toFixed(1)) {
    generateAlert(
        'Conversions',
        '    Conversions are too low: ' + todayStats.Conversions +
            ' Conversions by ' + hours + ':00, expecting at least ' +
            (pastStats.Conversions * thresholds.Conversions).toFixed(1));
  }

  if (thresholds.Cost &&
      todayStats.Cost > (pastStats.Cost * thresholds.Cost).toFixed(2)) {
    generateAlert(
        'Cost',
        '    Cost is too high: ' + todayStats.Cost + ' ' +
            account.getCurrencyCode() + ' by ' + hours +
            ':00, expecting at most ' +
            (pastStats.Cost * thresholds.Cost).toFixed(2));
  }

  // If no alerts were triggered, we will have only the heading text. Remove it.
  if (alertText.length == 1) {
    alertText = [];
  }

  var dataRows = [[
    account.getCustomerId(), todayStats.Impressions, todayStats.Clicks,
    todayStats.Conversions, todayStats.Cost, pastStats.Impressions.toFixed(0),
    pastStats.Clicks.toFixed(1), pastStats.Conversions.toFixed(1),
    pastStats.Cost.toFixed(2)
  ]];

  sheet.getRange(startingRow, CONST.FIRST_DATA_COLUMN,
    1, CONST.TOTAL_DATA_COLUMNS).setValues(dataRows);

  return alertText;
}

var SheetUtil = (function() {
  var thresholds = {};
  var upToHour = 1; // default
  var weeks = 26; // default

  var todayQuery = '';
  var pastQuery = '';

  var setupData = function(spreadsheet) {
    Logger.log('Running setupData');
    spreadsheet.getRangeByName('date').setValue(new Date());
    spreadsheet.getRangeByName('account_id').setValue(
        mccManager.mccAccount().getCustomerId());

    var getThresholdFor = function(field) {
      thresholds[field] = parseField(spreadsheet.
          getRangeByName(field).getValue());
    };
    getThresholdFor('Impressions');
    getThresholdFor('Clicks');
    getThresholdFor('Conversions');
    getThresholdFor('Cost');

    var now = new Date();

    // Basic reporting statistics are usually available with no more than a 3-hour
    // delay.
    var upTo = new Date(now.getTime() - 3 * 3600 * 1000);
    upToHour = parseInt(getDateStringInTimeZone('h', upTo));

    spreadsheet.getRangeByName('timestamp').setValue(
        DAYS[getDateStringInTimeZone('u', now)] + ', ' + upToHour + ':00');

    if (upToHour == 1) {
      // First run of the day, clear existing alerts.
      spreadsheet.getRangeByName(STATS['Clicks']['AlertRange']).clearContent();
      spreadsheet.getRangeByName(STATS['Impressions']['AlertRange']).
          clearContent();
      spreadsheet.getRangeByName(STATS['Conversions']['AlertRange'])
          .clearContent();
      spreadsheet.getRangeByName(STATS['Cost']['AlertRange']).clearContent();

      // Reset background and font Colors for all data rows.
      var bg = [];
      var ft = [];
      var bg_single = [
        'white', 'white', 'white', 'white', 'white', 'white', 'white', 'white',
        'white'
      ];
      var ft_single = [
        'black', 'black', 'black', 'black', 'black', 'black', 'black', 'black',
        'black'
      ];

      // Construct a 50-row array of colors to set.
      for (var a = 0; a < CONST.MCC_CHILD_ACCOUNT_LIMIT; ++a) {
        bg.push(bg_single);
        ft.push(ft_single);
      }

      var dataRegion = spreadsheet.getSheets()[0].getRange(
        CONST.FIRST_DATA_ROW, CONST.FIRST_DATA_COLUMN,
        CONST.MCC_CHILD_ACCOUNT_LIMIT, CONST.TOTAL_DATA_COLUMNS);

      dataRegion.setBackgrounds(bg);
      dataRegion.setFontColors(ft);
    }

    var weeksStr = spreadsheet.getRangeByName('weeks').getValue();
    weeks = parseInt(weeksStr.substring(0, weeksStr.indexOf(' ')));

    var dateRangeToCheck = getDateStringInPast(0, upTo);
    var dateRangeToEnd = getDateStringInPast(1, upTo);
    var dateRangeToStart = getDateStringInPast(1 + weeks * 7, upTo);
    var fields = 'HourOfDay, DayOfWeek, Clicks, Impressions, Conversions, Cost';

    todayQuery = 'SELECT ' + fields +
        ' FROM ACCOUNT_PERFORMANCE_REPORT DURING ' + dateRangeToCheck + ',' +
        dateRangeToCheck;
    pastQuery = 'SELECT ' + fields +
        ' FROM ACCOUNT_PERFORMANCE_REPORT WHERE DayOfWeek=' +
        DAYS[getDateStringInTimeZone('u', now)].toUpperCase() +
        ' DURING ' + dateRangeToStart + ',' + dateRangeToEnd;
  };

  var getThresholds = function() { return thresholds; };
  var getHourOfDay = function() { return upToHour; };
  var getWeeksToAvg = function() { return weeks; };
  var getPastQuery = function() { return pastQuery; };
  var getTodayQuery = function() { return todayQuery; };

  // The SheetUtil public interface.
  return {
    setupData: setupData,
    thresholds: getThresholds,
    hourOfDay: getHourOfDay,
    weeksToAvg: getWeeksToAvg,
    getPastQuery: getPastQuery,
    getTodayQuery: getTodayQuery
  };
})();

function sendEmail(account, alertTextArray, spreadsheet) {
  var bodyText = '';
  alertTextArray.forEach(function(alertText) {
    // When zero alerts, this is an empty array, which we don't want to add.
    if (alertText.length == 0) { return }
    bodyText += alertText.join('\n') + '\n\n';
  });
  bodyText = bodyText.trim();

  var email = spreadsheet.getRangeByName('email').getValue();
  if (bodyText.length > 0 && email && email.length > 0 &&
      email != 'foo@example.com') {
    Logger.log('Sending Email');
    MailApp.sendEmail(email,
        'Google Ads Account ' + account.getCustomerId() + ' misbehaved.',
        'Your account ' + account.getCustomerId() +
        ' is not performing as expected today: \n\n' +
        bodyText + '\n\n' +
        'Log into Google Ads and take a look: ' +
        'ads.google.com\n\nAlerts dashboard: ' +
        SPREADSHEET_URL);
  }
  else if (bodyText.length == 0) {
    Logger.log('No alerts triggered. No email being sent.');
  }
}

function toFloat(value) {
  value = value.toString().replace(/,/g, '');
  return parseFloat(value);
}

function parseField(value) {
  if (value == 'No alert') {
    return null;
  } else {
    return toFloat(value);
  }
}

function accumulateRows(rows, hours, weeks) {
  var result = {Clicks: 0, Impressions: 0, Conversions: 0, Cost: 0};

  while (rows.hasNext()) {
    var row = rows.next();
    var hour = row['HourOfDay'];

    if (hour < hours) {
      result = addRow(row, result, 1 / weeks);
    }
  }

  return result;
}

function addRow(row, previous, coefficient) {
  if (!coefficient) {
    coefficient = 1;
  }
  if (!row) {
    row = {Clicks: 0, Impressions: 0, Conversions: 0, Cost: 0};
  }
  if (!previous) {
    previous = {Clicks: 0, Impressions: 0, Conversions: 0, Cost: 0};
  }
  return {
    Clicks: parseInt(row['Clicks']) * coefficient + previous.Clicks,
    Impressions:
        parseInt(row['Impressions']) * coefficient + previous.Impressions,
    Conversions:
        parseInt(row['Conversions']) * coefficient + previous.Conversions,
    Cost: toFloat(row['Cost']) * coefficient + previous.Cost
  };
}

function checkInRange(today, yesterday, coefficient, field) {
  var yesterdayValue = yesterday[field] * coefficient;
  if (today[field] > yesterdayValue * 2) {
    Logger.log('' + field + ' too much');
  } else if (today[field] < yesterdayValue / 2) {
    Logger.log('' + field + ' too little');
  }
}

/**
 * Produces a formatted string representing a date in the past of a given date.
 *
 * @param {number} numDays The number of days in the past.
 * @param {date} date A date object. Defaults to the current date.
 * @return {string} A formatted string in the past of the given date.
 */
function getDateStringInPast(numDays, date) {
  date = date || new Date();
  var MILLIS_PER_DAY = 1000 * 60 * 60 * 24;
  var past = new Date(date.getTime() - numDays * MILLIS_PER_DAY);
  return getDateStringInTimeZone('yyyyMMdd', past);
}


/**
 * Produces a formatted string representing a given date in a given time zone.
 *
 * @param {string} format A format specifier for the string to be produced.
 * @param {date} date A date object. Defaults to the current date.
 * @param {string} timeZone A time zone. Defaults to the account's time zone.
 * @return {string} A formatted string of the given date in the given time zone.
 */
function getDateStringInTimeZone(format, date, timeZone) {
  date = date || new Date();
  timeZone = timeZone || AdsApp.currentAccount().getTimeZone();
  return Utilities.formatDate(date, timeZone, format);
}


/**
 * Module that deals with fetching and iterating through multiple accounts.
 *
 * @return {object} callable functions corresponding to the available
 * actions. Specifically, it currently supports next, current, mccAccount.
 */
var mccManager = (function() {
  var accountIterator;
  var mccAccount;
  var currentAccount;

  // Private one-time init function.
  var init = function() {
    var accountSelector = AdsManagerApp.accounts();

    // Use this to limit the accounts that are being selected in the report.
    if (CONFIG.ACCOUNT_LABEL) {
        accountSelector.withCondition("LabelNames CONTAINS '" +
            CONFIG.ACCOUNT_LABEL + "'");
    }

    accountSelector.withLimit(CONST.MCC_CHILD_ACCOUNT_LIMIT);
    accountIterator = accountSelector.get();

    mccAccount = AdsApp.currentAccount(); // save the mccAccount
    currentAccount = AdsApp.currentAccount();
  };

  /**
   * After calling this, AdsApp will have the next account selected.
   * If there are no more accounts to process, re-selects the original
   * MCC account.
   *
   * @return {AdsApp.Account} The account that has been selected.
   */
  var getNextAccount = function() {
    if (accountIterator.hasNext()) {
      currentAccount = accountIterator.next();
      AdsManagerApp.select(currentAccount);
      return currentAccount;
    }
    else {
      AdsManagerApp.select(mccAccount);
      return null;
    }

  };

  /**
   * Returns the currently selected account. This is cached for performance.
   *
   * @return {AdsApp.Account} The currently selected account.
   */
  var getCurrentAccount = function() {
    return currentAccount;
  };

 /**
  * Returns the original MCC account.
  *
  * @return {AdsApp.Account} The original account that was selected.
  */
  var getMccAccount = function() {
    return mccAccount;
  };

  // Set up internal variables; called only once, here.
  init();

  // Expose the external interface.
  return {
    next: getNextAccount,
    current: getCurrentAccount,
    mccAccount: getMccAccount
  };

})();

/**
 * Validates the provided spreadsheet URL and email address
 * to make sure that they're set up properly. Throws a descriptive error message
 * if validation fails.
 *
 * @param {string} spreadsheeturl The URL of the spreadsheet to open.
 * @return {Spreadsheet} The spreadsheet object itself, fetched from the URL.
 * @throws {Error} If the spreadsheet URL or email hasn't been set
 */
function validateAndGetSpreadsheet(spreadsheeturl) {
  if (spreadsheeturl == 'YOUR_SPREADSHEET_URL') {
    throw new Error('Please specify a valid Spreadsheet URL. You can find' +
        ' a link to a template in the associated guide for this script.');
  }
  var spreadsheet = SpreadsheetApp.openByUrl(spreadsheeturl);
  var email = spreadsheet.getRangeByName('email').getValue();
  if ('foo@example.com' == email) {
    throw new Error('Please either set a custom email address in the' +
        ' spreadsheet, or set the email field in the spreadsheet to blank' +
        ' to send no email.');
  }
  return spreadsheet;
}
