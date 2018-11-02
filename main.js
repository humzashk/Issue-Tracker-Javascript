document.getElementById('issueInputForm').addEventListener('submit', saveIssue);

function saveIssue(e){
    var issueDesc = document.getElementById('issueDescInput').Value;
    var issueSeverity = document.getElementById('issueSeverityInput').Value;
    var issueAssignedTo = document.getElementById('issueAssignedTo').Value;
    var issueId = chance.guid();
    var issueStatus = 'Open';

    var issue = {
        id: issueId,
        description: issueDesc,
        severity: issueSeverity,
        assignedTo: issueAssignedTo,
        status: issueStatus
    }

    if (localStorage.getItem('issues') == null){
        var issues = [];
        issue.push(issue);
        localStorage.setItem('issues', JSON.stringify(issues)); //JSON OBJECT
        
    } else  { 
        var issue = JSON.parse(localStorage.getItem('issues')); 
        issues.push(issue);
        localStorage.setItem('issues', JSON.stringify('issues')); // send it back to local storage
    }

    document.getElementById('issueInputForm').reset(); // values are removed

    fetchIssues();

    e.preventDefault(); // prevent form from submitting
}

function setStatusClosed(id){
    var issues = JSON.parse(localStorage.getItem('issues'));

    for (var i = 0; i < issues.length; i++){
        if(issues[i].id == id) {
            issues[i].status = 'closed';
        }
    }

    localStorage.setItem('issues', JSON.stringify(issues));

    fetchIssues(); //Status closed

    function deleteIssue(id){
        for (var i = 0; i < issues.length; i++){
            if(issues[i].id == id) {
                issues[i].status = 'closed';
            }
            issues.splice(i, 1);
        }
    }
}

function fetchIssues(){
    var issues = JSON.parse(localStorage.getItem('issues'));
    var issuesListe = document.getElementById('issuesList');

    issuesList.innerHTML = '';

    for( var i = 0; i < issues.length; i++){
        var id = issues [i].id;
        var desc = issues[i].description;
        var severity = issues[i].severity;
        var assignedTo = issues[i].assignedTo;
        var status = issues[i].status;

        issuesList.innerHTML += '<div class="well>'+ 
                                '<h6>Issue ID: ' + id + '</h6>'
                                 '<p><span class="label label-info">' + status + '</span> </p>' +
                                 '<h3>' + desc + '</h3>' + 
                                 '<p> <span class="glyphicon glyphicon-time"> </span>' +  severity + '</p>'+
                                 '<p> <span class="glyphicon glyphicon-user"> </span>' + assignedTo + '</p>' +
                                 '<a href="#" onclick="setStatusClosed(\''+id+'\')" class="btn btn-warning"> Close </a>' +
                                 '<a href="#" onclick="deleteIssue(\''+id+'\')" class="btn btn-danger"> Delete </a>' +
                                 '</div>';
    }

}