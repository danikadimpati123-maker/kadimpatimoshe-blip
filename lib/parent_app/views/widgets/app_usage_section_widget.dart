import 'package:flutter/material.dart';
import 'package:firebase_database/firebase_database.dart';

class AppUsageSectionWidget extends StatefulWidget {
  final String deviceCode;
  const AppUsageSectionWidget({Key? key, required this.deviceCode}) : super(key: key);

  @override
  _AppUsageSectionWidgetState createState() => _AppUsageSectionWidgetState();
}

class _AppUsageSectionWidgetState extends State<AppUsageSectionWidget> {
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
                    Icon(Icons.bar_chart, color: Colors.teal, size: 22),
                    SizedBox(width: 8),
                    Text(
                      "App Usage Statistics",
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
                stream: FirebaseDatabase.instance.ref('devices/${widget.deviceCode}/appUsage').onValue,
                builder: (context, AsyncSnapshot<DatabaseEvent> snapshot) {
                  if (!snapshot.hasData || snapshot.data!.snapshot.value == null) {
                    return const Padding(
                      padding: EdgeInsets.all(8.0),
                      child: Text("No app usage data available.", style: TextStyle(color: Colors.grey)),
                    );
                  }

                  final data = snapshot.data!.snapshot.value;
                  final List<Map<dynamic, dynamic>> usageList = [];

                  if (data is List) {
                    for (var item in data) {
                      if (item is Map) usageList.add(item);
                    }
                  } else if (data is Map) {
                    data.forEach((key, value) {
                      if (value is Map) usageList.add(value);
                    });
                  }

                  if (usageList.isEmpty) {
                    return const Padding(
                      padding: EdgeInsets.all(8.0),
                      child: Text("No app usage data available.", style: TextStyle(color: Colors.grey)),
                    );
                  }

                  // Sort by hoursUsed descending
                  usageList.sort((a, b) => (b['hoursUsed'] as num? ?? 0).compareTo(a['hoursUsed'] as num? ?? 0));

                  return ListView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: usageList.length,
                    itemBuilder: (context, index) {
                      var item = usageList[index];

                      return ListTile(
                        dense: true,
                        leading: const Icon(Icons.phone_android, color: Colors.blueGrey, size: 18),
                        title: Text(
                          item['appName'] ?? 'App Name',
                          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                        ),
                        subtitle: Text("Usage: ${item['durationText'] ?? '0 mins'}", style: const TextStyle(fontSize: 11)),
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
