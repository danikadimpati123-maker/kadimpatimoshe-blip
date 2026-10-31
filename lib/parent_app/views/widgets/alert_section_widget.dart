import 'package:flutter/material.dart';
import 'package:firebase_database/firebase_database.dart';

class AlertSectionWidget extends StatefulWidget {
  final String deviceCode;
  const AlertSectionWidget({Key? key, required this.deviceCode}) : super(key: key);

  @override
  _AlertSectionWidgetState createState() => _AlertSectionWidgetState();
}

class _AlertSectionWidgetState extends State<AlertSectionWidget> {
  bool _isExpanded = false;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 8.0, horizontal: 4.0),
      elevation: 3,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(12.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Row(
                  children: [
                    Icon(Icons.warning_amber_rounded, color: Colors.orange, size: 22),
                    SizedBox(width: 8),
                    Text(
                      "Child Keyword & Activity Alerts",
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Colors.teal),
                    ),
                  ],
                ),
                IconButton(
                  icon: Icon(_isExpanded ? Icons.visibility_off : Icons.visibility, color: Colors.teal),
                  onPressed: () {
                    setState(() {
                      _isExpanded = !_isExpanded;
                    });
                  },
                ),
              ],
            ),
            if (_isExpanded) ...[
              const Divider(height: 15),
              StreamBuilder(
                stream: FirebaseDatabase.instance.ref('devices/${widget.deviceCode}/alerts').onValue,
                builder: (context, AsyncSnapshot<DatabaseEvent> snapshot) {
                  if (!snapshot.hasData || snapshot.data!.snapshot.value == null) {
                    return const Padding(
                      padding: EdgeInsets.all(8.0),
                      child: Text("No alerts received yet.", style: TextStyle(color: Colors.grey)),
                    );
                  }

                  Map<dynamic, dynamic> alertsMap = snapshot.data!.snapshot.value as Map<dynamic, dynamic>;
                  var alertKeys = alertsMap.keys.toList();

                  return ListView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: alertKeys.length,
                    itemBuilder: (context, index) {
                      var alertKey = alertKeys[index];
                      var alertData = alertsMap[alertKey];

                      var timestampVal = alertData['timestamp'];
                      String formattedTime = "Just now";
                      if (timestampVal != null) {
                        var date = DateTime.fromMillisecondsSinceEpoch(timestampVal);
                        formattedTime = "${date.hour}:${date.minute.toString().padLeft(2, '0')} - ${date.day}/${date.month}/${date.year}";
                      }

                      return ListTile(
                        dense: true,
                        leading: const Icon(Icons.notifications_active, color: Colors.orange, size: 18),
                        title: Text(
                          "Type: ${alertData['type'] ?? 'Alert'}",
                          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                        ),
                        subtitle: Text("Time: $formattedTime", style: const TextStyle(fontSize: 11)),
                      );
                    },
                  );
                },
              ),
            ],
          ],
        ),
      ),
    );
  }
}
